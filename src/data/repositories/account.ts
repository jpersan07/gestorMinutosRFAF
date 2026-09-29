import type { Id } from '../../domain'
import type { AppDatabase } from '../db'
import type { DataEnv } from '../env'
import type { TeamContext } from '../remote/teamContext'

/** Ámbito con el que funciona la app: dispositivo, cuenta, equipo y temporada. */
export interface AppScope {
  readonly deviceId: string
  readonly userId: Id
  readonly teamId: Id
  readonly seasonId: Id
}

/** Cuenta y equipo a los que están vinculados los datos locales. */
export interface LocalAccount {
  readonly userId: Id | null
  readonly teamId: Id | null
  readonly seasonId: Id | null
}

export interface LocalDataSummary {
  readonly players: number
  readonly matches: number
  readonly events: number
}

/** Motivo para borrar los datos locales antes de entrar en un equipo (F3-3, B-2). */
export type DiscardReason = 'test-data' | 'other-team'

async function getMeta<T>(db: AppDatabase, key: string): Promise<T | null> {
  return ((await db.meta.get(key))?.value as T | undefined) ?? null
}

/** Identificador del dispositivo: se crea una vez y sobrevive a cierres de sesión y borrados. */
export async function getDeviceId(db: AppDatabase, env: DataEnv): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getMeta<string>(db, 'deviceId')
    if (existing) return existing
    const deviceId = env.newId()
    await db.meta.put({ key: 'deviceId', value: deviceId })
    return deviceId
  })
}

export async function getLocalAccount(db: AppDatabase): Promise<LocalAccount> {
  const [userId, teamId, seasonId] = await Promise.all([
    getMeta<Id>(db, 'accountUserId'),
    getMeta<Id>(db, 'teamId'),
    getMeta<Id>(db, 'seasonId'),
  ])
  return { userId, teamId, seasonId }
}

/** Ámbito guardado en el móvil para una cuenta (permite arrancar sin conexión). */
export async function localScopeFor(db: AppDatabase, deviceId: string, userId: Id): Promise<AppScope | null> {
  const account = await getLocalAccount(db)
  if (account.userId !== userId || !account.teamId || !account.seasonId) return null
  return { deviceId, userId, teamId: account.teamId, seasonId: account.seasonId }
}

export async function summarizeLocalData(db: AppDatabase): Promise<LocalDataSummary> {
  const [players, matches, events] = await Promise.all([
    db.players.count(),
    db.matches.count(),
    db.matchEvents.count(),
  ])
  return { players, matches, events }
}

/**
 * ¿Hay que borrar los datos locales para entrar en `teamId`?
 *   · sin datos → no;
 *   · datos sin vincular a ningún equipo (pruebas de la Fase 2) → 'test-data';
 *   · datos de otro equipo → 'other-team';
 *   · datos del mismo equipo (misma u otra cuenta del equipo) → no: se conservan.
 */
export function discardReasonFor(local: LocalAccount, summary: LocalDataSummary, teamId: Id): DiscardReason | null {
  if (summary.players + summary.matches + summary.events === 0) return null
  if (local.teamId === null) return 'test-data'
  if (local.teamId !== teamId) return 'other-team'
  return null
}

/** Borra todos los datos locales salvo el identificador del dispositivo. */
export async function wipeLocalData(db: AppDatabase): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const deviceId = await getMeta<string>(db, 'deviceId')
    await Promise.all(db.tables.map((table) => table.clear()))
    if (deviceId) await db.meta.put({ key: 'deviceId', value: deviceId })
  })
}

/**
 * Guarda en el móvil el equipo, la temporada activa y los miembros descargados del servidor,
 * y vincula los datos locales a esta cuenta y equipo. Requiere temporada activa.
 */
export async function applyTeamContext(
  db: AppDatabase,
  env: DataEnv,
  userId: Id,
  context: TeamContext & { readonly season: NonNullable<TeamContext['season']> },
): Promise<AppScope> {
  const now = env.now()
  return db.transaction('rw', [db.meta, db.teams, db.seasons, db.profiles, db.teamMembers], async () => {
    await db.teams.put({
      id: context.team.id,
      name: context.team.name,
      currentSeasonId: context.team.currentSeasonId,
      updatedAt: now,
    })
    await db.seasons.put({ id: context.season.id, teamId: context.team.id, name: context.season.name, updatedAt: now })
    await db.profiles.bulkPut(context.members.map((m) => ({ id: m.userId, displayName: m.displayName, updatedAt: now })))
    await db.teamMembers.where('teamId').equals(context.team.id).delete()
    await db.teamMembers.bulkPut(context.members.map((m) => ({ teamId: context.team.id, userId: m.userId, role: m.role })))
    await db.meta.bulkPut([
      { key: 'accountUserId', value: userId },
      { key: 'teamId', value: context.team.id },
      { key: 'seasonId', value: context.season.id },
    ])
    const deviceId = (await getMeta<string>(db, 'deviceId')) ?? env.newId()
    await db.meta.put({ key: 'deviceId', value: deviceId })
    return { deviceId, userId, teamId: context.team.id, seasonId: context.season.id }
  })
}
