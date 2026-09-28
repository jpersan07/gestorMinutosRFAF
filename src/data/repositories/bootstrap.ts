import { seasonNameFor, type Id } from '../../domain'
import type { AppDatabase } from '../db'
import type { DataEnv } from '../env'

/** Entrenadores iniciales (PRD §2). No son datos de prueba: son los usuarios de la app. */
export const INITIAL_COACHES = ['ISAAC', 'JORDI', 'JOSÉ'] as const

export const DEFAULT_TEAM_NAME = 'Mi equipo'

export interface AppScope {
  readonly deviceId: string
  readonly teamId: Id
  readonly seasonId: Id
}

async function getMeta<T>(db: AppDatabase, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

/**
 * Primer arranque (o arranque normal): garantiza que existan el id del dispositivo,
 * el equipo, la temporada actual y los entrenadores. Es idempotente.
 */
export async function bootstrap(db: AppDatabase, env: DataEnv, today: string): Promise<AppScope> {
  return db.transaction('rw', [db.meta, db.teams, db.seasons, db.coaches], async () => {
    const now = env.now()
    const tracked = { createdAt: now, updatedAt: now, syncState: 'pending' as const }

    let deviceId = await getMeta<string>(db, 'deviceId')
    if (!deviceId) {
      deviceId = env.newId()
      await db.meta.put({ key: 'deviceId', value: deviceId })
    }

    let teamId = await getMeta<Id>(db, 'currentTeamId')
    if (!teamId || !(await db.teams.get(teamId))) {
      teamId = (await db.teams.toCollection().first())?.id
      if (!teamId) {
        teamId = env.newId()
        await db.teams.add({ id: teamId, name: DEFAULT_TEAM_NAME, ...tracked })
      }
      await db.meta.put({ key: 'currentTeamId', value: teamId })
    }

    let seasonId = await getMeta<Id>(db, 'currentSeasonId')
    if (!seasonId || !(await db.seasons.get(seasonId))) {
      const name = seasonNameFor(today)
      const team = teamId
      seasonId = (await db.seasons.where('teamId').equals(team).filter((s) => s.name === name).first())?.id
      if (!seasonId) {
        seasonId = env.newId()
        await db.seasons.add({ id: seasonId, teamId, name, ...tracked })
      }
      await db.meta.put({ key: 'currentSeasonId', value: seasonId })
    }

    if ((await db.coaches.where('teamId').equals(teamId).count()) === 0) {
      const team = teamId
      await db.coaches.bulkAdd(
        INITIAL_COACHES.map((name) => ({ id: env.newId(), teamId: team, name, active: true, ...tracked })),
      )
    }

    return { deviceId, teamId, seasonId }
  })
}

export async function getSelectedCoachId(db: AppDatabase): Promise<Id | null> {
  return (await getMeta<Id>(db, 'selectedCoachId')) ?? null
}

export async function setSelectedCoachId(db: AppDatabase, coachId: Id | null): Promise<void> {
  if (coachId === null) await db.meta.delete('selectedCoachId')
  else await db.meta.put({ key: 'selectedCoachId', value: coachId })
}
