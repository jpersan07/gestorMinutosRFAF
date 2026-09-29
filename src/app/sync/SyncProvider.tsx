import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { countConflicts, countPending, logError, pushOnce, type PushReport } from '../../data'
import type { EpochMs } from '../../domain'
import { useAuth } from '../auth/AuthContext'
import { useApp } from '../context'
import { useOnline } from '../useOnline'
import { SyncContext, type SyncContextValue } from './SyncContext'

/** Intervalo de sincronización normal (F3-6). */
export const SYNC_INTERVAL_MS = 15_000
/** Margen para agrupar varios toques seguidos en una sola subida inmediata. */
const CHANGE_DEBOUNCE_MS = 300

/**
 * Programa la subida al servidor (bloque 3c). Nunca bloquea al entrenador: todo se guarda antes
 * en el móvil y esto solo lo sube por detrás. Una sola subida a la vez; si llega otra petición
 * mientras se sube, se hace una pasada más al terminar.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { db, scope } = useApp()
  const { supabase, status: auth } = useAuth()
  const online = useOnline()
  const canSync = online && auth.kind === 'ready' && !auth.sessionLost

  const pending = useLiveQuery(() => countPending(db), [db], 0)
  const conflicts = useLiveQuery(() => countConflicts(db), [db], 0)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<'ok' | 'error' | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<EpochMs | null>(null)

  const running = useRef<Promise<PushReport | null> | null>(null)
  const again = useRef(false)
  const canSyncRef = useRef(canSync)
  // Se actualiza en un efecto (no durante el render); va antes que los efectos que la usan.
  useEffect(() => {
    canSyncRef.current = canSync
  }, [canSync])

  const syncNow = useCallback((): Promise<PushReport | null> => {
    if (!canSyncRef.current) return Promise.resolve(null)
    if (running.current) {
      again.current = true
      return running.current
    }
    const run = (async () => {
      setSyncing(true)
      let report: PushReport | null = null
      try {
        do {
          again.current = false
          report = await pushOnce({ db, supabase, scope })
          setLastResult(report.ok ? 'ok' : 'error')
          if (report.ok) setLastSyncedAt(Date.now())
        } while (again.current && canSyncRef.current)
      } catch (error) {
        setLastResult('error')
        await logError(db, error, { at: 'sync' })
      } finally {
        running.current = null
        setSyncing(false)
      }
      return report
    })()
    running.current = run
    return run
  }, [db, supabase, scope])

  // Al recuperar la conexión / volver a entrar: subir ya.
  useEffect(() => {
    if (canSync) void syncNow()
  }, [canSync, syncNow])

  // Cada 15 s (con la app visible) y al volver de segundo plano.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow()
    }, SYNC_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [syncNow])

  // Tras un cambio local (acción crítica): subir inmediatamente, sin esperar a los 15 s.
  const previousPending = useRef(pending)
  useEffect(() => {
    const increased = pending > previousPending.current
    previousPending.current = pending
    if (!increased) return
    const timer = window.setTimeout(() => void syncNow(), CHANGE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [pending, syncNow])

  const value = useMemo<SyncContextValue>(
    () => ({ status: { online, syncing, pending, conflicts, lastResult, lastSyncedAt }, syncNow }),
    [online, syncing, pending, conflicts, lastResult, lastSyncedAt, syncNow],
  )
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
