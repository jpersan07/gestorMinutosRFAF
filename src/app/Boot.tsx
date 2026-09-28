import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AppDatabase,
  bootstrap,
  getSelectedCoachId,
  logError,
  setSelectedCoachId,
  systemEnv,
  type AppScope,
} from '../data'
import type { Id } from '../domain'
import { AppContext, type AppContextValue } from './context'
import { localToday } from './dates'

const db = new AppDatabase()

type BootState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly scope: AppScope; readonly coachId: Id | null }
  | { readonly status: 'error' }

/** Abre la base de datos local y prepara el contexto antes de mostrar ninguna pantalla. */
export function Boot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BootState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Pide al navegador que no borre los datos locales por falta de espacio.
        void navigator.storage?.persist?.()
        const scope = await bootstrap(db, systemEnv, localToday())
        const coachId = await getSelectedCoachId(db)
        if (!cancelled) setState({ status: 'ready', scope, coachId })
      } catch (error) {
        await logError(db, error, { at: 'boot' })
        if (!cancelled) setState({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectCoach = useCallback(async (coachId: Id | null) => {
    await setSelectedCoachId(db, coachId)
    setState((current) => (current.status === 'ready' ? { ...current, coachId } : current))
  }, [])

  const value = useMemo<AppContextValue | null>(
    () =>
      state.status === 'ready'
        ? { db, env: systemEnv, scope: state.scope, coachId: state.coachId, selectCoach }
        : null,
    [state, selectCoach],
  )

  if (state.status === 'error') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-black">No se pueden guardar datos</h1>
        <p className="text-muted">
          Este navegador no permite guardar datos en el dispositivo (¿modo privado?). Abre la app en una ventana
          normal o instálala en la pantalla de inicio.
        </p>
      </main>
    )
  }

  if (!value) {
    return <main className="min-h-dvh" aria-busy="true" />
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
