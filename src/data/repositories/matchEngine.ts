import {
  advance,
  computeMinutes,
  execute,
  replay,
  type CommandContext,
  type DomainError,
  type Id,
  type MatchCommand,
  type MatchEvent,
  type MatchState,
} from '../../domain'
import type { AppDatabase, MatchRecord, PlayerMatchMinutesRecord, StoredEvent } from '../db'
import type { DataEnv } from '../env'
import { failResult, okResult, type DataResult } from '../errors'

/** Quién ejecuta el comando: este dispositivo y el entrenador seleccionado. */
export interface Actor {
  readonly deviceId: string
  readonly coachId: Id
}

export async function listMatchEvents(db: AppDatabase, matchId: Id): Promise<StoredEvent[]> {
  return db.matchEvents.where('matchId').equals(matchId).sortBy('seq')
}

export async function loadMatchState(db: AppDatabase, matchId: Id): Promise<MatchState> {
  return replay(matchId, await listMatchEvents(db, matchId))
}

type Step = (state: MatchState, ctx: CommandContext) => { state: MatchState; events: MatchEvent[]; error: DomainError | null }

const ENGINE_TABLES = (db: AppDatabase) => [db.matches, db.matchEvents, db.matchSquads, db.playerMatchMinutes]

/**
 * Núcleo de escritura. SIEMPRE dentro de una transacción: lee los eventos, aplica el motor
 * y guarda eventos + caché del partido + proyección de minutos de forma atómica.
 * Dexie serializa las transacciones de escritura, así que el final automático de parte y un
 * cambio pulsado a la vez nunca generan el mismo `seq` (y el índice único lo impediría).
 */
async function runStep(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  actor: Actor,
  step: Step,
): Promise<DataResult<MatchState>> {
  const match = await db.matches.get(matchId)
  if (!match) return failResult({ code: 'NOT_FOUND' })

  const stored = await listMatchEvents(db, matchId)
  const state = replay(matchId, stored)
  const ctx: CommandContext = {
    now: env.now(),
    deviceId: actor.deviceId,
    coachId: actor.coachId,
    squad: (await db.matchSquads.get(matchId))?.playerIds ?? [],
    newId: env.newId,
  }
  const result = step(state, ctx)

  if (result.events.length > 0) {
    await db.matchEvents.bulkAdd(result.events.map((event) => ({ ...event, syncState: 'pending' as const })))
    await db.matches.put(matchRecordFor(match, result.state, result.events, actor, ctx.now))
    if (result.state.status === 'finished' || result.state.status === 'saved') {
      await writeMinutesProjection(db, matchId, [...stored, ...result.events])
    }
  }

  return result.error ? failResult(result.error) : okResult(result.state)
}

function matchRecordFor(
  match: MatchRecord,
  state: MatchState,
  events: readonly MatchEvent[],
  actor: Actor,
  now: number,
): MatchRecord {
  const tookControl = events.some((e) => e.type === 'SETUP_STARTED' || e.type === 'CONTROL_TAKEN')
  const saved = events.find((e) => e.type === 'MATCH_SAVED')
  return {
    ...match,
    status: state.status,
    controllerDeviceId: state.controllerDeviceId,
    managedBy: tookControl ? actor.coachId : match.managedBy,
    savedAt: saved ? saved.occurredAt : match.savedAt,
    updatedAt: now,
    syncState: 'pending',
  }
}

async function writeMinutesProjection(db: AppDatabase, matchId: Id, events: readonly MatchEvent[]): Promise<void> {
  const rows: PlayerMatchMinutesRecord[] = computeMinutes(events).map((p) => ({
    matchId,
    playerId: p.playerId,
    secondsPlayed: p.secondsPlayed,
    minutesPlayed: p.minutesPlayed,
    started: p.started,
    syncState: 'pending',
  }))
  await db.playerMatchMinutes.where('matchId').equals(matchId).delete()
  await db.playerMatchMinutes.bulkPut(rows)
}

/** Ejecuta un comando del entrenador (tick incluido). Los eventos automáticos se guardan aunque el comando falle. */
export async function runMatchCommand(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  command: MatchCommand,
  actor: Actor,
): Promise<DataResult<MatchState>> {
  return db.transaction('rw', ENGINE_TABLES(db), () =>
    runStep(db, env, matchId, actor, (state, ctx) => execute(state, command, ctx)),
  )
}

/** Materializa los finales de parte vencidos (temporizador, volver a primer plano, arranque). */
export async function advanceMatch(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  actor: Actor,
): Promise<DataResult<MatchState>> {
  return db.transaction('rw', ENGINE_TABLES(db), () =>
    runStep(db, env, matchId, actor, (state, ctx) => ({ ...advance(state, ctx), error: null })),
  )
}

/** GUARDAR PARTIDO (tras la doble confirmación): exige RESULTADO. */
export async function saveMatch(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  actor: Actor,
): Promise<DataResult<MatchState>> {
  return db.transaction('rw', [...ENGINE_TABLES(db), db.matchReports], async () => {
    const report = await db.matchReports.get(matchId)
    if (!report || report.result.trim() === '') return failResult({ code: 'RESULT_REQUIRED' })
    return runStep(db, env, matchId, actor, (state, ctx) => execute(state, { type: 'SAVE_MATCH' }, ctx))
  })
}

/** Partido en juego o en descanso que controla este dispositivo (para reabrirlo al arrancar). */
export async function findActiveMatchId(db: AppDatabase, deviceId: string): Promise<Id | null> {
  const active = await db.matches
    .where('status')
    .anyOf('first_half', 'halftime', 'second_half')
    .filter((m) => m.controllerDeviceId === deviceId)
    .first()
  return active?.id ?? null
}
