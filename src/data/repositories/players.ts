import { validatePlayerInput, type Id, type PlayerInput } from '../../domain'
import type { AppDatabase, PlayerRecord } from '../db'
import type { DataEnv } from '../env'
import { editVersion } from './editVersion'
import { failResult, okResult, type DataResult } from '../errors'

export function sortPlayers(players: readonly PlayerRecord[]): PlayerRecord[] {
  return [...players].sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, 'es'))
}

export async function listPlayers(db: AppDatabase, teamId: Id): Promise<PlayerRecord[]> {
  return sortPlayers(await db.players.where('teamId').equals(teamId).toArray())
}

async function takenNumbers(db: AppDatabase, teamId: Id, exceptPlayerId: Id | null): Promise<number[]> {
  const players = await db.players.where('teamId').equals(teamId).toArray()
  return players.filter((p) => p.active && p.id !== exceptPlayerId).map((p) => p.number)
}

/** AÑADIR JUGADOR: nombre y dorsal. Queda como jugador activo del equipo. */
export async function createPlayer(
  db: AppDatabase,
  env: DataEnv,
  teamId: Id,
  input: PlayerInput,
): Promise<DataResult<PlayerRecord>> {
  return db.transaction('rw', db.players, async () => {
    const errors = validatePlayerInput(input, await takenNumbers(db, teamId, null))
    if (errors.length > 0 || input.number === null) return failResult({ code: 'VALIDATION', errors })
    const now = env.now()
    const player: PlayerRecord = {
      id: env.newId(),
      teamId,
      name: input.name.trim(),
      number: input.number,
      active: true,
      createdAt: now,
      updatedAt: now,
      syncState: 'pending',
      syncIssue: null,
    }
    await db.players.add(player)
    return okResult(player)
  })
}

export async function updatePlayer(
  db: AppDatabase,
  env: DataEnv,
  playerId: Id,
  input: PlayerInput & { readonly active: boolean },
): Promise<DataResult<PlayerRecord>> {
  return db.transaction('rw', db.players, async () => {
    const current = await db.players.get(playerId)
    if (!current) return failResult({ code: 'NOT_FOUND' })
    const taken = input.active ? await takenNumbers(db, current.teamId, playerId) : []
    const errors = validatePlayerInput(input, taken)
    if (errors.length > 0 || input.number === null) return failResult({ code: 'VALIDATION', errors })
    const player: PlayerRecord = {
      ...current,
      name: input.name.trim(),
      number: input.number,
      active: input.active,
      updatedAt: editVersion(env, current.updatedAt),
      // Editar resuelve un conflicto anterior (p. ej. dorsal): se vuelve a intentar subir.
      syncState: 'pending',
      syncIssue: null,
    }
    await db.players.put(player)
    return okResult(player)
  })
}
