import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  countConflicts,
  countPending,
  logError,
  supabaseRemote,
  syncOnce,
  takeControl,
  type SyncReport,
  type TakeControlResult,
} from '../../data'
import type { EpochMs, Id } from '../../domain'
import { useAuth } from '../auth/AuthContext'
import { useApp } from '../context'
import { useOnline } from '../useOnline'
import { SyncContext, type SyncContextValue } from './SyncContext'

/** Pasada completa (subida + descarga) cada 15 s (F3-6). */
export const SYNC_INTERVAL_MS = 15_000
/** Partido abierto en modo consulta: descarga cada 5 s. */
export const VIEWER_INTERVAL_MS = 5_000
/** Margen para agrupar varios toques seguidos en una sola subida inmediata. */
const CHANGE_DEBOUNCE_MS = 300

/**
 * Programa la sincronización (3c subida + 3d descarga). Nunca bloquea al entrenador: todo se
 * guarda antes en el móvil y esto solo lo sube y descarga por detrás. Una sola pasada a la vez;
 * si llega otra petición mientras tanto, se hace una más al terminar. La siguiente pasada
 * periódica se programa siempre desde el final de la anterior.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { db, env, scope } = useApp()
  const { supabase, clock, status: auth } = useAuth()
  const online = useOnline()
  const canSync = online && auth.kind === 'ready' && !auth.sessionLost
  const remote = useMemo(() => supabaseRemote(supabase), [supabase])
  const context = useMemo(() => ({ db, supabase, remote, scope, clock }), [db, supabase, remote, scope, clock])

  const pending = useLiveQuery(() => countPending(db), [db], 0)
  const conflicts = useLiveQuery(() => countConflicts(db), [db], 0)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<'ok' | 'error' | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<EpochMs | null>(null)
  const [watched, setWatched] = useState<Id | null>(null)

  const running = useRef<Promise<SyncReport | null> | null>(null)
  const again = useRef(false)
  const fullTimer = useRef<number | undefined>(undefined)
  const canSyncRef = useRef(canSync)
  // Se actualiza en un efecto (no durante el render); va antes que los efectos que la usan.
  useEffect(() => {
    canSyncRef.current = canSync
  }, [canSync])

  const record = useCallback((report: SyncReport) => {
    setLastResult(report.ok ? 'ok' : 'error')
    if (report.ok) setLastSyncedAt(Date.now())
  }, [])

  const syncNowRef = useRef<() => Promise<SyncReport | null>>(() => Promise.resolve(null))
  const scheduleFull = useCallback(() => {
    window.clearTimeout(fullTimer.current)
    fullTimer.current = window.setTimeout(function tick() {
      if (document.visibilityState === 'visible') void syncNowRef.current()
      else fullTimer.current = window.setTimeout(tick, SYNC_INTERVAL_MS)
    }, SYNC_INTERVAL_MS)
  }, [])

  const syncNow = useCallback((): Promise<SyncReport | null> => {
    if (!canSyncRef.current) {
      scheduleFull()
      return Promise.resolve(null)
    }
    if (running.current) {
      again.current = true
      return running.current
    }
    const run = (async () => {
      setSyncing(true)
      let report: SyncReport | null = null
      try {
        do {
          again.current = false
          report = await syncOnce(context)
          record(report)
          // Pérdida de control: una pasada más para traer ya el estado oficial.
          if (report.controlLost.length > 0 && report.ok) again.current = true
        } while (again.current && canSyncRef.current)
      } catch (error) {
        setLastResult('error')
        await logError(db, error, { at: 'sync' })
      } finally {
        running.current = null
        setSyncing(false)
        scheduleFull()
      }
      return report
    })()
    running.current = run
    return run
  }, [context, db, record, scheduleFull])

  useEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  // Al recuperar la conexión / volver a entrar: sincronizar ya.
  useEffect(() => {
    if (canSync) void syncNow()
  }, [canSync, syncNow])

  // Cada 15 s (con la app visible) y al volver de segundo plano.
  useEffect(() => {
    scheduleFull()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(fullTimer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [scheduleFull, syncNow])

  // Modo consulta: el partido abierto se descarga cada 5 s (sin bloquear nada).
  useEffect(() => {
    if (!watched) return
    let cancelled = false
    let timer: number | undefined
    const loop = async () => {
      if (cancelled) return
      if (document.visibilityState === 'visible' && canSyncRef.current) {
        try {
          record(await syncOnce(context, { matchId: watched }))
        } catch (error) {
          await logError(db, error, { at: 'sync', matchId: watched })
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void loop(), VIEWER_INTERVAL_MS)
    }
    timer = window.setTimeout(() => void loop(), VIEWER_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [watched, context, db, record])

  // Tras un cambio local (acción crítica): subir inmediatamente, sin esperar a los 15 s.
  const previousPending = useRef(pending)
  useEffect(() => {
    const increased = pending > previousPending.current
    previousPending.current = pending
    if (!increased) return
    const timer = window.setTimeout(() => void syncNow(), CHANGE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [pending, syncNow])

  const takeControlNow = useCallback(
    async (matchId: Id): Promise<TakeControlResult> => {
      const result = await takeControl({ ...context, env, online: canSyncRef.current }, matchId)
      if (result.ok) void syncNow()
      return result
    },
    [context, env, syncNow],
  )

  const value = useMemo<SyncContextValue>(
    () => ({
      status: { online, syncing, pending, conflicts, lastResult, lastSyncedAt },
      syncNow,
      watchMatch: setWatched,
      takeControl: takeControlNow,
    }),
    [online, syncing, pending, conflicts, lastResult, lastSyncedAt, syncNow, takeControlNow],
  )
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
