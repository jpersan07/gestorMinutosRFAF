import {
  canEditMatchDetails,
  normalizeMatchDetails,
  validateMatchDetails,
  type Id,
  type MatchDetailsInput,
} from '../../domain'
import type { AppDatabase, MatchRecord } from '../db'
import type { DataEnv } from '../env'
import { failResult, okResult, type DataResult } from '../errors'

/** Por fecha y hora; los partidos sin fecha, al final (por orden de creación). */
export function sortMatches(matches: readonly MatchRecord[]): MatchRecord[] {
  const key = (m: MatchRecord) => `${m.matchDate ?? '9999-99-99'} ${m.kickoffTime ?? '99:99'}`
  return [...matches].sort((a, b) => key(a).localeCompare(key(b)) || a.createdAt - b.createdAt)
}

export async function listMatches(db: AppDatabase, seasonId: Id): Promise<MatchRecord[]> {
  return sortMatches(await db.matches.where('seasonId').equals(seasonId).toArray())
}

/**
 * Escudo: `undefined` = no tocar, `null` = quitar, string = nueva imagen (data URL ya redimensionada).
 */
export type CrestChange = string | null | undefined

export interface MatchDetailsChange extends MatchDetailsInput {
  readonly crest?: CrestChange
}

async function applyCrest(
  db: AppDatabase,
  env: DataEnv,
  currentCrestId: Id | null,
  crest: CrestChange,
): Promise<Id | null> {
  if (crest === undefined) return currentCrestId
  if (currentCrestId) await db.crests.delete(currentCrestId)
  if (crest === null) return null
  const now = env.now()
  const id = env.newId()
  await db.crests.add({ id, dataUrl: crest, createdAt: now, updatedAt: now, syncState: 'pending' })
  return id
}

/** NUEVO PARTIDO: solo el rival es obligatorio. */
export async function createMatch(
  db: AppDatabase,
  env: DataEnv,
  scope: { readonly teamId: Id; readonly seasonId: Id },
  change: MatchDetailsChange,
): Promise<DataResult<MatchRecord>> {
  const errors = validateMatchDetails(change)
  if (errors.length > 0) return failResult({ code: 'VALIDATION', errors })
  return db.transaction('rw', [db.matches, db.crests], async () => {
    const now = env.now()
    const match: MatchRecord = {
      id: env.newId(),
      teamId: scope.teamId,
      seasonId: scope.seasonId,
      ...normalizeMatchDetails(change),
      crestId: await applyCrest(db, env, null, change.crest),
      status: 'scheduled',
      managedBy: null,
      controllerDeviceId: null,
      savedAt: null,
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
    }
    await db.matches.add(match)
    return okResult(match)
  })
}

/** EDITAR: permitido hasta pulsar PLAY. */
export async function updateMatchDetails(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  change: MatchDetailsChange,
): Promise<DataResult<MatchRecord>> {
  const errors = validateMatchDetails(change)
  if (errors.length > 0) return failResult({ code: 'VALIDATION', errors })
  return db.transaction('rw', [db.matches, db.crests], async () => {
    const current = await db.matches.get(matchId)
    if (!current) return failResult({ code: 'NOT_FOUND' })
    if (!canEditMatchDetails(current.status)) return failResult({ code: 'LOCKED' })
    const match: MatchRecord = {
      ...current,
      ...normalizeMatchDetails(change),
      crestId: await applyCrest(db, env, current.crestId, change.crest),
      updatedAt: env.now(),
      syncState: 'pending',
    }
    await db.matches.put(match)
    return okResult(match)
  })
}
