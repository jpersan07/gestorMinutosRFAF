import { createContext, useContext } from 'react'
import type { AppDatabase, AppScope, DataEnv } from '../data'
import type { Id } from '../domain'

/** Contexto de las pantallas de la app (solo existe con una cuenta y un equipo activos). */
export interface AppContextValue {
  readonly db: AppDatabase
  readonly env: DataEnv
  readonly scope: AppScope
  /** El entrenador es el usuario autenticado (Supabase Auth). */
  readonly coachId: Id
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp fuera de AppContext')
  return value
}

export function useCoachId(): Id {
  return useApp().coachId
}
