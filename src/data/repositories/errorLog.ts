import type { AppDatabase } from '../db'

/** Máximo de errores guardados en el móvil mientras no se pueden subir (C-5). */
export const MAX_LOCAL_ERRORS = 200

/** Registra errores técnicos para depurar. Nunca lanza: el log no puede romper la app. */
export async function logError(db: AppDatabase, error: unknown, context: unknown = null): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  try {
    await db.transaction('rw', db.errorLog, async () => {
      await db.errorLog.add({
        createdAt: Date.now(),
        message: message.slice(0, 2000),
        context: JSON.parse(JSON.stringify(context ?? null)),
      })
      const excess = (await db.errorLog.count()) - MAX_LOCAL_ERRORS
      if (excess > 0) await db.errorLog.orderBy('id').limit(excess).delete()
    })
  } catch {
    console.error('No se pudo registrar el error', message, error)
  }
}
