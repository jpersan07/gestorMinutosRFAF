import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate } from 'react-router'
import { findActiveMatchId } from '../../data'
import { useAuth } from '../auth/AuthContext'

/**
 * Punto de entrada ("/"): INICIAR SESIÓN, elegir equipo o la app. Si este dispositivo tiene un
 * partido en juego o en el descanso, se reabre directamente (recuperación tras recargar).
 */
export function Start() {
  const { db, deviceId, status } = useAuth()
  const activeMatchId = useLiveQuery(() => findActiveMatchId(db, deviceId), [db, deviceId], 'loading')

  if (status.kind === 'signed-out') return <Navigate to="/login" replace />
  if (status.kind === 'needs-team') return <Navigate to="/entrar" replace />
  if (activeMatchId === 'loading') return null
  if (activeMatchId) return <Navigate to={`/partidos/${activeMatchId}/juego`} replace />
  return <Navigate to="/partidos" replace />
}
