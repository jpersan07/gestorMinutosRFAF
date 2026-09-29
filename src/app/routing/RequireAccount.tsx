import { useMemo } from 'react'
import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { AppContext, type AppContextValue } from '../context'

/** Las pantallas de la app exigen cuenta y equipo; les da su contexto (entrenador = usuario). */
export function RequireAccount() {
  const { db, env, status } = useAuth()
  const scope = status.kind === 'ready' ? status.scope : null
  const value = useMemo<AppContextValue | null>(
    () => (scope ? { db, env, scope, coachId: scope.userId } : null),
    [db, env, scope],
  )
  if (!value) return <Navigate to="/" replace />
  return (
    <AppContext.Provider value={value}>
      <Outlet />
    </AppContext.Provider>
  )
}
