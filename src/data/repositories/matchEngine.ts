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
import { lastControlEvent, matchClockOffset } from '../sync/clock'

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
  // Otro dispositivo tomó el control (el servidor rechazó los eventos de este): no se escribe
  // nada más en este partido, ni por comandos ni por el final automático de las partes.
  if (match.controlLostAt) return failResult({ code: 'CONTROL_LOST' })

  const stored = await listMatchEvents(db, matchId)
  const state = replay(matchId, stored)
  // Hora de los eventos = reloj del móvil + corrección respecto al servidor, congelada para
  // este periodo de control desde PLAY (ver sync/clock.ts).
  const liveOffset = env.clockOffsetMs?.() ?? 0
  const offset = matchClockOffset(match, stored, liveOffset)
  const ctx: CommandContext = {
    now: env.now() - liveOffset + offset.ms,
    deviceId: actor.deviceId,
    coachId: actor.coachId,
    squad: (await db.matchSquads.get(matchId))?.playerIds ?? [],
    newId: env.newId,
  }
  const result = step(state, ctx)

  if (result.events.length > 0) {
    await db.matchEvents.bulkAdd(result.events.map((event) => ({ ...event, syncState: 'pending' as const })))
    const control = lastControlEvent([...stored, ...result.events])
    await db.matches.put({
      ...matchRecordFor(match, result.state, result.events, actor, env.now()),
      clockOffset: control ? { ms: offset.ms, controlEventId: control.id } : (match.clockOffset ?? null),
    })
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
    // La fila del partido solo sube los DATOS editables (rival, fecha…): los eventos no la dejan
    // pendiente. El estado del partido lo deriva el servidor de los eventos.
    syncState: match.syncState,
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
  // TOMAR CONTROL es una operación del servidor (sync/takeControl.ts): este móvil no pasa a
  // controlar el partido hasta que el servidor lo acepta.
  if (command.type === 'TAKE_CONTROL') return failResult({ code: 'TAKE_CONTROL_REQUIRES_SERVER' })
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
    .filter((m) => m.controllerDeviceId === deviceId && !m.controlLostAt)
    .first()
  return active?.id ?? null
}
