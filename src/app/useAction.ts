import { useCallback, useState } from 'react'
import { logError } from '../data'
import { useApp } from './context'
import { UNEXPECTED_ERROR } from './messages'

/**
 * Ejecuta una acción asíncrona de la interfaz. Un error inesperado se registra en el log
 * local y el entrenador ve un mensaje claro, nunca el error técnico.
 */
export function useAction() {
  const { db } = useApp()
  const [busy, setBusy] = useState(false)
  const [unexpected, setUnexpected] = useState<string | null>(null)

  const run = useCallback(
    async <T,>(action: () => Promise<T>, context?: unknown): Promise<T | undefined> => {
      setBusy(true)
      setUnexpected(null)
      try {
        return await action()
      } catch (error) {
        await logError(db, error, context)
        setUnexpected(UNEXPECTED_ERROR)
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [db],
  )

  return { run, busy, unexpected }
}
