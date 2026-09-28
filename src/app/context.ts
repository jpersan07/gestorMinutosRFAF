import { createContext, useContext } from 'react'
import type { AppDatabase, AppScope, DataEnv } from '../data'
import type { Id } from '../domain'

export interface AppContextValue {
  readonly db: AppDatabase
  readonly env: DataEnv
  readonly scope: AppScope
  /** Entrenador seleccionado en este dispositivo ("¿QUIÉN ERES?"). */
  readonly coachId: Id | null
  readonly selectCoach: (coachId: Id | null) => Promise<void>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp fuera de AppContext')
  return value
}

/** Para pantallas protegidas por RequireCoach: siempre hay entrenador. */
export function useCoachId(): Id {
  const { coachId } = useApp()
  if (!coachId) throw new Error('No hay entrenador seleccionado')
  return coachId
}
