import { afterEach } from 'vitest'
import { FORMATIONS, type FormationId, type Id, type Lineup } from '../../domain'
import { AppDatabase } from '../db'
import type { DataEnv } from '../env'
import { bootstrap, type AppScope } from '../repositories/bootstrap'
import { createMatch } from '../repositories/matches'
import { createPlayer } from '../repositories/players'

/** 28/09/2026 18:00 (Madrid). */
export const T0 = Date.UTC(2026, 8, 28, 16, 0, 0)

const opened: AppDatabase[] = []
let counter = 0

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close()
    await db.delete()
  }
})

/** Reloj controlable + ids deterministas. */
export class TestEnv implements DataEnv {
  time = T0
  private next = 0
  readonly now = () => this.time
  readonly newId = () => `id-${String(++this.next).padStart(4, '0')}`
  wait(seconds: number) {
    this.time += seconds * 1000
  }
}

export function openTestDb(name = `test-${++counter}`): AppDatabase {
  const db = new AppDatabase(name)
  opened.push(db)
  return db
}

/** Simula cerrar la app y volver a abrirla: nueva instancia sobre la misma base de datos. */
export function reopen(db: AppDatabase): AppDatabase {
  db.close()
  const again = new AppDatabase(db.name)
  opened.push(again)
  return again
}

export interface Fixture {
  db: AppDatabase
  env: TestEnv
  scope: AppScope
  coachId: Id
  playerIds: Id[]
  matchId: Id
}

/** Equipo con 16 jugadores y un partido pendiente. */
export async function fixture(): Promise<Fixture> {
  const db = openTestDb()
  const env = new TestEnv()
  const scope = await bootstrap(db, env, '2026-09-28')
  const coachId = (await db.coaches.toArray())[0]!.id
  const playerIds: Id[] = []
  for (let number = 1; number <= 16; number++) {
    const result = await createPlayer(db, env, scope.teamId, { name: `Jugador ${number}`, number })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    playerIds.push(result.value.id)
  }
  const match = await createMatch(db, env, scope, {
    opponent: 'Rival',
    matchDate: '2026-09-28',
    kickoffTime: '18:00',
    location: null,
  })
  if (!match.ok) throw new Error(JSON.stringify(match.error))
  return { db, env, scope, coachId, playerIds, matchId: match.value.id }
}

export function lineupOf(formationId: FormationId, playerIds: readonly Id[]): Lineup {
  const slots: Record<string, Id> = {}
  FORMATIONS[formationId].slots.forEach((slot, i) => {
    const playerId = playerIds[i]
    if (playerId !== undefined) slots[slot.id] = playerId
  })
  return { formationId, slots }
}
