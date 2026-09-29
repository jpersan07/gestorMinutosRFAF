import { Link, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthContext'

export const SESSION_LOST_TEXT = 'Tu sesión ha caducado. El partido sigue guardándose en este móvil.'

/** Aviso dentro de la pantalla de partido (B-5): no tapa ningún control. */
export function SessionLostNotice() {
  const { status } = useAuth()
  if (status.kind !== 'ready' || !status.sessionLost) return null
  return (
    <p role="status" className="rounded-xl bg-warn px-3 py-2 text-sm font-bold text-accent-ink">
      {SESSION_LOST_TEXT} Vuelve a iniciar sesión al terminar.
    </p>
  )
}

/**
 * B-5 fuera de la pantalla de partido: aviso en el flujo de la página (no flotante, para no tapar
 * la navegación) con acceso a INICIAR SESIÓN. En /juego lo muestra la propia pantalla.
 */
export function SessionLostBanner() {
  const { status } = useAuth()
  const { pathname } = useLocation()
  if (status.kind !== 'ready' || !status.sessionLost || pathname === '/login' || pathname.endsWith('/juego')) {
    return null
  }
  return (
    <div role="status" className="flex items-center gap-3 bg-warn px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-accent-ink">
      <p className="flex-1 text-sm font-bold">{SESSION_LOST_TEXT}</p>
      <Link to="/login" className="rounded-lg bg-accent-ink px-3 py-2 text-sm font-black text-warn">
        INICIAR SESIÓN
      </Link>
    </div>
  )
}
