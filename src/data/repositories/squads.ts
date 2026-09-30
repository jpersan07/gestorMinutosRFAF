import {
  aggregatePlayerTotals,
  canEditSquad,
  countNotCalledUp,
  type EpochMs,
  type Id,
  type MatchMinutesRecord,
  type PlayerTotals,
  type SquadDecision,
} from '../../domain'
import type { AppDatabase, MatchSquadRecord, PlayerRecord } from '../db'
import type { DataEnv } from '../env'
import { failResult, okResult, type DataResult } from '../errors'

export async function getSquad(db: AppDatabase, matchId: Id): Promise<readonly Id[] | null> {
  return (await db.matchSquads.get(matchId))?.playerIds ?? null
}

/** GUARDAR convocatoria. Solo jugadores existentes; bloqueada tras PLAY. */
export async function saveSquad(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  playerIds: readonly Id[],
  coachId: Id | null,
): Promise<DataResult<MatchSquadRecord>> {
  return db.transaction('rw', [db.matches, db.matchSquads, db.players], async () => {
    const match = await db.matches.get(matchId)
    if (!match) return failResult({ code: 'NOT_FOUND' })
    if (!canEditSquad(match.status)) return failResult({ code: 'LOCKED' })
    const existing = new Set((await db.players.bulkGet([...playerIds])).flatMap((p) => (p ? [p.id] : [])))
    const record: MatchSquadRecord = {
      matchId,
      playerIds: [...new Set(playerIds)].filter((id) => existing.has(id)),
      updatedAt: env.now(),
      updatedBy: coachId,
      syncState: 'pending',
      syncIssue: null,
    }
    await db.matchSquads.put(record)
    return okResult(record)
  })
}

interface SeasonMatch {
  readonly matchId: Id
  /** Convocatoria definitiva: la que congeló MATCH_STARTED (la guardada, si el evento no está). */
  readonly squad: readonly Id[]
  /**
   * Momento de la decisión: el más tardío entre PLAY (MATCH_STARTED) y el último guardado de la
   * convocatoria. En un partido normal es PLAY; en MODO PRUEBAS (PLAY fechado hacia atrás) es el
   * guardado real. null si el móvil no tiene el MATCH_STARTED (no hay convocatoria definitiva).
   */
  readonly decidedAt: EpochMs | null
}

/**
 * Partidos que cuentan para el histórico de la temporada: finalizados o guardados (los mismos
 * que los minutos acumulados). Todo con consultas en bloque, sin una consulta por partido.
 */
async function finishedSeasonMatches(db: AppDatabase, seasonId: Id): Promise<SeasonMatch[]> {
  const matches = await db.matches
    .where('seasonId')
    .equals(seasonId)
    .filter((m) => m.status === 'finished' || m.status === 'saved')
    .toArray()
  const ids = matches.map((m) => m.id)
  if (ids.length === 0) return []
  const [squads, starts] = await Promise.all([
    db.matchSquads.bulkGet(ids),
    db.matchEvents
      .where('matchId')
      .anyOf(ids)
      .filter((e) => e.type === 'MATCH_STARTED')
      .toArray(),
  ])
  const startedBy = new Map(starts.map((e) => [e.matchId, e]))
  return ids.map((matchId, i) => {
    const started = startedBy.get(matchId)
    return {
      matchId,
      squad: started?.type === 'MATCH_STARTED' ? started.squad : (squads[i]?.playerIds ?? []),
      decidedAt: started ? Math.max(started.occurredAt, squads[i]?.updatedAt ?? started.occurredAt) : null,
    }
  })
}

/**
 * Minutos acumulados de la temporada (partidos finalizados o guardados), calculados desde
 * la proyección de eventos. Se usan para ordenar la convocatoria.
 */
export async function seasonPlayerTotals(db: AppDatabase, seasonId: Id): Promise<Map<Id, PlayerTotals>> {
  const history = await finishedSeasonMatches(db, seasonId)
  const minutes = await db.playerMatchMinutes
    .where('matchId')
    .anyOf(history.map((h) => h.matchId))
    .toArray()
  const records: MatchMinutesRecord[] = history.map((h) => ({
    matchId: h.matchId,
    squad: h.squad,
    players: minutes.filter((m) => m.matchId === h.matchId),
  }))
  return aggregatePlayerTotals(records)
}

/**
 * "SIN CONVOCAR" de la temporada: en cuántos partidos finalizados o guardados NO estuvo
 * convocado cada jugador, contando solo los partidos decididos después de su alta en el equipo y
 * con la convocatoria definitiva (la congelada al pulsar PLAY: cambios anteriores sin guardar o
 * sobrescritos no cuentan).
 */
export async function seasonNotCalledUp(
  db: AppDatabase,
  seasonId: Id,
  players: ReadonlyArray<Pick<PlayerRecord, 'id' | 'createdAt'>>,
): Promise<Map<Id, number>> {
  const history = await finishedSeasonMatches(db, seasonId)
  const decisions: SquadDecision[] = history.flatMap((h) =>
    h.decidedAt === null ? [] : [{ squad: h.squad, kickoffAt: h.decidedAt }],
  )
  return countNotCalledUp(
    decisions,
    players.map((p) => ({ id: p.id, joinedAt: p.createdAt })),
  )
}
