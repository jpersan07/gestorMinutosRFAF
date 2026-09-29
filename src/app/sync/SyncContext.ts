import { createContext, useContext } from 'react'
import type { PushReport } from '../../data'
import type { EpochMs } from '../../domain'

export interface SyncStatus {
  readonly online: boolean
  readonly syncing: boolean
  /** Cambios deportivos pendientes de subir. */
  readonly pending: number
  /** Datos rechazados por el servidor a la espera de que el entrenador los cambie. */
  readonly conflicts: number
  /** Resultado de la última subida (null si todavía no se ha intentado). */
  readonly lastResult: 'ok' | 'error' | null
  readonly lastSyncedAt: EpochMs | null
}

export interface SyncContextValue {
  readonly status: SyncStatus
  /** Sube ya (o se suma a la subida en curso). null si no se puede (sin red o sin sesión). */
  readonly syncNow: () => Promise<PushReport | null>
}

export const SyncContext = createContext<SyncContextValue | null>(null)

export function useSync(): SyncContextValue {
  const value = useContext(SyncContext)
  if (!value) throw new Error('useSync fuera de SyncProvider')
  return value
}
