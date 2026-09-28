import { useLocation } from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../../ui/Button'

/**
 * Aviso de versión nueva. Nunca se muestra en la pantalla de partido: actualizar
 * recarga la app y no debe ocurrir durante el juego.
 */
export function UpdatePrompt() {
  const { pathname } = useLocation()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!needRefresh || pathname.endsWith('/juego')) return null
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-panel-strong p-3 shadow-2xl"
    >
      <p className="flex-1 font-semibold">Hay una versión nueva de la app.</p>
      <Button size="md" onClick={() => void updateServiceWorker(true)}>
        ACTUALIZAR
      </Button>
    </div>
  )
}
