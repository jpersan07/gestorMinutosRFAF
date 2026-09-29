import { createContext, useContext, useEffect } from 'react'
import type { SyncReport, TakeControlResult } from '../../data'
import type { EpochMs, Id } from '../../domain'

export interface SyncStatus {
  readonly online: boolean
  readonly syncing: boolean
  /** Cambios deportivos pendientes de subir. */
  readonly pending: number
  /** Datos rechazados por el servidor a la espera de que el entrenador los cambie. */
  readonly conflicts: number
  /** Resultado de la última pasada (null si todavía no se ha intentado). */
  readonly lastResult: 'ok' | 'error' | null
  readonly lastSyncedAt: EpochMs | null
}

export interface SyncContextValue {
  readonly status: SyncStatus
  /** Sube y descarga ya (o se suma a la pasada en curso). null si no se puede (sin red o sin sesión). */
  readonly syncNow: () => Promise<SyncReport | null>
  /** Partido abierto en modo consulta: se descarga cada 5 s mientras esté en pantalla. */
  readonly watchMatch: (matchId: Id | null) => void
  /** TOMAR CONTROL (solo con conexión; ver data/sync/takeControl.ts). */
  readonly takeControl: (matchId: Id) => Promise<TakeControlResult>
}

export const SyncContext = createContext<SyncContextValue | null>(null)

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext)
  if (!value) throw new Error('useSync fuera de SyncProvider')
  return value
}

/** Mientras el componente esté montado y `enabled`, el partido se descarga cada 5 s. */
export function useWatchMatch(matchId: Id, enabled: boolean): void {
  const { watchMatch } = useSync()
  useEffect(() => {
    if (!enabled) return
    watchMatch(matchId)
    return () => watchMatch(null)
  }, [matchId, enabled, watchMatch])
}
