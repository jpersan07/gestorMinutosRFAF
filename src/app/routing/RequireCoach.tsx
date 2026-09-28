import { Navigate, Outlet } from 'react-router'
import { useApp } from '../context'

/** El "modo entrenador" exige haber elegido quién eres. */
export function RequireCoach() {
  const { coachId } = useApp()
  return coachId ? <Outlet /> : <Navigate to="/quien" replace />
}
