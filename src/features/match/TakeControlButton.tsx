import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useApp } from '../../app/context'
import type { MatchView } from '../../app/match/useMatch'
import { useSync } from '../../app/sync/SyncContext'
import { useAction } from '../../app/useAction'
import type { TakeControlResult } from '../../data'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'

const FAILURE: Record<Exclude<TakeControlResult, { ok: true }>['reason'], string> = {
  OFFLINE: 'Necesitas conexión para tomar el control.',
  NETWORK: 'No se ha podido tomar el control (sin conexión con el servidor). Sigues en modo consulta.',
  TAKEN_BY_OTHER: 'Otro dispositivo ha tomado el control antes. Sigues en modo consulta.',
  NOT_SYNCED: 'Este móvil tiene cambios del partido sin subir. Espera a que se sincronicen.',
  BUSY: 'El otro dispositivo está registrando cambios ahora mismo. Inténtalo de nuevo.',
  REJECTED: 'No se puede tomar el control de este partido ahora.',
}

/**
 * TOMAR CONTROL: solo con conexión y solo si el servidor lo acepta (operación atómica en el
 * servidor). Hasta entonces este móvil sigue en modo consulta.
 */
export function TakeControlButton({ view }: { view: MatchView }) {
  const { db } = useApp()
  const { status, takeControl } = useSync()
  const { run, busy, unexpected } = useAction()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const manager = useLiveQuery(
    async () => (view.match.managedBy ? await db.profiles.get(view.match.managedBy) : undefined),
    [db, view.match.managedBy],
  )

  return (
    <div className="flex flex-col gap-2">
      {(error ?? unexpected) && (
        <p role="alert" className="rounded-xl bg-danger px-3 py-2 font-bold text-danger-ink">
          {error ?? unexpected}
        </p>
      )}
      <Button disabled={!status.online || busy} onClick={() => setAsking(true)}>
        TOMAR CONTROL
      </Button>
      {!status.online && <p className="text-center font-semibold text-warn">Necesitas conexión para tomar el control.</p>}
      <ConfirmDialog
        open={asking}
        title="¿Tomar el control?"
        confirmLabel="TOMAR CONTROL"
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          setError(null)
          const result = await run(() => takeControl(view.match.id), { at: 'takeControl' })
          setAsking(false)
          if (result && !result.ok) setError(FAILURE[result.reason])
        }}
      >
        <p>
          {manager ? `${manager.displayName} dejará` : 'El otro dispositivo dejará'} de poder modificar el partido y lo
          gestionarás desde este móvil.
        </p>
      </ConfirmDialog>
    </div>
  )
}
