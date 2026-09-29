import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useApp } from '../../app/context'
import type { MatchView } from '../../app/match/useMatch'
import { errorMessage } from '../../app/messages'
import { describeRejectedEvents } from '../../app/sync/describeRejected'
import { useSync } from '../../app/sync/SyncContext'
import { useAction } from '../../app/useAction'
import { acknowledgeControlLoss, canAcknowledgeControlLoss } from '../../data'
import { Button } from '../../ui/Button'
import { MatchReadOnly } from './MatchReadOnly'

/**
 * Este móvil ha perdido el control del partido (3c/3d). Solo lectura: aquí ya no se puede
 * registrar nada. Muestra los cambios de este móvil que NO se aplicaron (cuarentena) y, en cuanto
 * está descargado, el partido tal como lo ha dejado el otro dispositivo. ENTENDIDO solo cierra el
 * aviso (el partido sigue en modo consulta) y solo con el estado oficial ya cargado.
 */
export function LostControlScreen({ view, now }: { view: MatchView; now: number }) {
  const { db, env, scope } = useApp()
  const { status } = useSync()
  const navigate = useNavigate()
  const { run, busy, unexpected } = useAction()
  const [error, setError] = useState<string | null>(null)
  const rejected = useLiveQuery(
    async () => (await db.rejectedEvents.where('matchId').equals(view.match.id).sortBy('seq')).map((r) => r.event),
    [db, view.match.id],
  )
  const nameOf = (id: string) => view.playersById.get(id)?.name ?? 'Jugador'
  const lines = rejected ? describeRejectedEvents(rejected, nameOf) : []
  const officialLoaded = canAcknowledgeControlLoss(view.match, view.events, scope)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 py-8">
      <section role="alert" aria-labelledby="lost-control-title" className="flex flex-col gap-4 rounded-2xl bg-warn p-5 text-accent-ink">
        <h1 id="lost-control-title" className="text-2xl font-black">
          OTRO DISPOSITIVO HA TOMADO EL CONTROL
        </h1>
        <p className="text-lg font-semibold">
          de este partido ({view.match.opponent}). Los cambios hechos aquí sin conexión <strong>NO</strong> se han
          aplicado:
        </p>
        {lines.length > 0 ? (
          <ul aria-label="Cambios no aplicados" className="flex list-inside list-disc flex-col gap-1 text-lg font-bold">
            {lines.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="font-semibold">No había cambios pendientes en este móvil.</p>
        )}
        <p className="font-semibold">El partido continúa en el otro dispositivo.</p>
      </section>

      {officialLoaded ? (
        <>
          <h2 className="text-center text-sm font-bold tracking-[0.2em] text-muted">ASÍ ESTÁ EL PARTIDO AHORA</h2>
          <MatchReadOnly view={view} now={now} />
        </>
      ) : (
        <p role="status" className="rounded-xl bg-panel p-4 text-center font-bold">
          {status.online
            ? 'Cargando el partido del otro dispositivo…'
            : 'Esperando conexión para cargar el partido del otro dispositivo.'}
        </p>
      )}

      {(error ?? unexpected) && (
        <p role="alert" className="rounded-xl bg-danger px-3 py-2 font-bold text-danger-ink">
          {error ?? unexpected}
        </p>
      )}
      <Button
        disabled={!officialLoaded || busy}
        onClick={async () => {
          setError(null)
          const result = await run(() => acknowledgeControlLoss(db, env, view.match.id, scope))
          if (result && !result.ok) setError(errorMessage(result.error))
        }}
      >
        ENTENDIDO
      </Button>
      <Button variant="secondary" onClick={() => navigate('/partidos', { replace: true })}>
        VOLVER A PARTIDOS
      </Button>
    </main>
  )
}
