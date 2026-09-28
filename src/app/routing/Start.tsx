import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate } from 'react-router'
import { findActiveMatchId } from '../../data'
import { useApp } from '../context'

/**
 * Punto de entrada ("/"). Si este dispositivo tiene un partido en juego o en el descanso,
 * se reabre directamente (recuperación tras recargar o cerrar la app).
 */
export function Start() {
  const { db, scope, coachId } = useApp()
  const activeMatchId = useLiveQuery(() => findActiveMatchId(db, scope.deviceId), [db, scope.deviceId], 'loading')

  if (activeMatchId === 'loading') return null
  if (!coachId) return <Navigate to="/quien" replace />
  if (activeMatchId) return <Navigate to={`/partidos/${activeMatchId}/juego`} replace />
  return <Navigate to="/partidos" replace />
}
