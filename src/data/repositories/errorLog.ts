import type { AppDatabase } from '../db'

/** Registra errores técnicos para depurar. Nunca lanza: el log no puede romper la app. */
export async function logError(db: AppDatabase, error: unknown, context: unknown = null): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  try {
    await db.errorLog.add({ createdAt: Date.now(), message, context: JSON.parse(JSON.stringify(context ?? null)) })
  } catch {
    console.error('No se pudo registrar el error', message, error)
  }
}
