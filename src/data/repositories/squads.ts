import { aggregatePlayerTotals, canEditSquad, type Id, type MatchMinutesRecord, type PlayerTotals } from '../../domain'
import type { AppDatabase, MatchSquadRecord } from '../db'
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
    }
    await db.matchSquads.put(record)
    return okResult(record)
  })
}

/**
 * Minutos acumulados de la temporada (partidos finalizados o guardados), calculados desde
 * la proyección de eventos. Se usan para ordenar la convocatoria.
 */
export async function seasonPlayerTotals(db: AppDatabase, seasonId: Id): Promise<Map<Id, PlayerTotals>> {
  const matches = await db.matches
    .where('seasonId')
    .equals(seasonId)
    .filter((m) => m.status === 'finished' || m.status === 'saved')
    .toArray()
  const records: MatchMinutesRecord[] = await Promise.all(
    matches.map(async (match) => ({
      matchId: match.id,
      squad: (await getSquad(db, match.id)) ?? [],
      players: await db.playerMatchMinutes.where('matchId').equals(match.id).toArray(),
    })),
  )
  return aggregatePlayerTotals(records)
}
