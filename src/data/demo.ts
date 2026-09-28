import type { AppDatabase } from './db'
import type { DataEnv } from './env'
import type { AppScope } from './repositories/bootstrap'
import { createMatch } from './repositories/matches'
import { createPlayer } from './repositories/players'

/**
 * Datos DEMO para probar la interfaz en desarrollo. Todos llevan "DEMO" en el nombre.
 * Solo se cargan con un botón visible en modo desarrollo; nunca automáticamente.
 */
export const DEMO_PREFIX = 'DEMO'

export async function loadDemoData(db: AppDatabase, env: DataEnv, scope: AppScope): Promise<void> {
  for (let number = 1; number <= 16; number++) {
    await createPlayer(db, env, scope.teamId, { name: `${DEMO_PREFIX} Jugador ${number}`, number })
  }
  const today = new Date(env.now())
  const inDays = (days: number) => {
    const date = new Date(today.getTime() + days * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  await createMatch(db, env, scope, {
    opponent: `${DEMO_PREFIX} Rival A`,
    matchDate: inDays(3),
    kickoffTime: '18:00',
    location: 'Campo DEMO',
  })
  await createMatch(db, env, scope, {
    opponent: `${DEMO_PREFIX} Rival B`,
    matchDate: inDays(10),
    kickoffTime: null,
    location: null,
  })
  await createMatch(db, env, scope, { opponent: `${DEMO_PREFIX} Rival C`, matchDate: null, kickoffTime: null, location: null })
}
