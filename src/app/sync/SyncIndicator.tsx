import { useSync } from './SyncContext'

/** Estado de la subida al servidor, para la lista de partidos. */
export function SyncIndicator() {
  const { status } = useSync()
  const { pending, conflicts, lastResult } = status

  let text: string
  let tone: string
  if (pending === 0 && lastResult !== 'error') {
    text = '✓ Sincronizado'
    tone = 'text-accent'
  } else if (lastResult === 'error' && status.online) {
    text = 'No se ha podido sincronizar; se reintentará'
    tone = 'text-warn'
  } else {
    text = pending === 1 ? '1 cambio pendiente' : `${pending} cambios pendientes`
    tone = 'text-muted'
  }

  return (
    <div aria-live="polite" className="flex flex-col gap-1 text-sm font-bold">
      <p role="status" aria-label="Sincronización" className={tone}>
        {text}
      </p>
      {conflicts > 0 && (
        <p className="text-warn">
          ⚠ {conflicts === 1 ? '1 cambio rechazado por el servidor' : `${conflicts} cambios rechazados por el servidor`}
        </p>
      )}
    </div>
  )
}
