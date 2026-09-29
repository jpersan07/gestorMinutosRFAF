import { createContext, useContext } from 'react'
import type { AppDatabase, AppScope, DataEnv, ServerClock, Supabase } from '../../data'
import type { Id } from '../../domain'

export type AuthStatus =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'needs-team'; readonly userId: Id }
  /** sessionLost: la sesión dejó de ser válida con un partido en juego (B-5): se sigue, con aviso. */
  | { readonly kind: 'ready'; readonly scope: AppScope; readonly sessionLost: boolean }

export interface AuthContextValue {
  readonly db: AppDatabase
  /** Hora corregida con la del servidor (ver ServerClock). */
  readonly env: DataEnv
  readonly clock: ServerClock
  readonly supabase: Supabase
  readonly deviceId: string
  readonly status: AuthStatus
  /** Mensaje para la pantalla de acceso (p. ej. "ya no perteneces al equipo"). */
  readonly notice: string | null
  /** Devuelve null si ha ido bien o el mensaje de error para el entrenador. */
  readonly signIn: (email: string, password: string) => Promise<string | null>
  readonly signOut: (notice?: string) => Promise<void>
  /** Tras guardar la contraseña nueva (B-4): la sesión de recuperación pasa a ser la sesión de la app. */
  readonly completePasswordRecovery: (userId: Id) => void
  /** Termina la entrada tras elegir equipo y (si hacía falta) borrar datos locales. */
  readonly enterTeam: (scope: AppScope) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth fuera de AuthContext')
  return value
}
