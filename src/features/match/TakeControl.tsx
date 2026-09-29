import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useApp } from '../../app/context'
import { useMatchDispatch, type MatchView } from '../../app/match/useMatch'
import { useAction } from '../../app/useAction'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Page } from '../../ui/Page'

/** El partido lo controla otro dispositivo: se puede consultar o TOMAR CONTROL. */
export function TakeControl({ view }: { view: MatchView }) {
  const { db } = useApp()
  const dispatch = useMatchDispatch(view.match.id)
  const { run, busy } = useAction()
  const [asking, setAsking] = useState(false)
  const manager = useLiveQuery(
    async () => (view.match.managedBy ? await db.profiles.get(view.match.managedBy) : undefined),
    [db, view.match.managedBy],
  )

  return (
    <Page title="PARTIDO" back={`/partidos/${view.match.id}`}>
      <div className="flex flex-col gap-4 rounded-2xl bg-panel p-5">
        <p className="text-lg font-bold">
          Este partido lo está gestionando otro dispositivo{manager ? ` (${manager.displayName})` : ''}.
        </p>
        <p className="text-muted">Puedes tomar el control para seguir gestionándolo desde este móvil.</p>
        <Button onClick={() => setAsking(true)}>TOMAR CONTROL</Button>
      </div>
      <ConfirmDialog
        open={asking}
        title="¿Tomar el control?"
        confirmLabel="TOMAR CONTROL"
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          await run(() => dispatch({ type: 'TAKE_CONTROL' }))
          setAsking(false)
        }}
      >
        <p>El otro dispositivo dejará de poder modificar el partido.</p>
      </ConfirmDialog>
    </Page>
  )
}
