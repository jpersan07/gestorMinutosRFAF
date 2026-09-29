import { useLocation } from 'react-router'
import { useOnline } from '../useOnline'

export const OFFLINE_TEXT = 'SIN CONEXIÓN — Los datos se guardarán cuando vuelva Internet.'

/** Aviso dentro de la pantalla de partido: no tapa ningún control. */
export function OfflineNotice() {
  const online = useOnline()
  if (online) return null
  return (
    <p role="status" className="rounded-xl bg-panel-strong px-3 py-2 text-sm font-bold">
      {OFFLINE_TEXT}
    </p>
  )
}

/** Aviso en el flujo de la página (no flotante). En /juego lo muestra la propia pantalla. */
export function OfflineBanner() {
  const online = useOnline()
  const { pathname } = useLocation()
  if (online || pathname.endsWith('/juego')) return null
  return (
    <p role="status" className="bg-panel-strong px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-center text-sm font-bold">
      {OFFLINE_TEXT}
    </p>
  )
}
