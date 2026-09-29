import type { AppDatabase } from '../db'

// Exclusión mutua: nunca dos pasadas de sincronización a la vez (otra pestaña, el temporizador,
// un cambio o TOMAR CONTROL). Subida y descarga comparten el mismo candado.

const chains = new WeakMap<AppDatabase, Promise<unknown>>()

export function withSyncLock<T>(db: AppDatabase, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks) return locks.request(`gestor-minutos-sync:${db.name}`, task)
  const previous = chains.get(db) ?? Promise.resolve()
  const run = previous.then(task, task)
  chains.set(
    db,
    run.catch(() => undefined),
  )
  return run
}
