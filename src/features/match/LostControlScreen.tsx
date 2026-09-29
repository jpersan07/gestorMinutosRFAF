import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import { useApp } from '../../app/context'
import type { MatchView } from '../../app/match/useMatch'
import { describeRejectedEvents } from '../../app/sync/describeRejected'
import { Button } from '../../ui/Button'

/**
 * El servidor rechazó los eventos de este móvil porque otro dispositivo tomó el control (3c).
 * Solo lectura: aquí ya no se puede registrar nada. Los cambios no aplicados están en cuarentena.
 */
export function LostControlScreen({ view }: { view: MatchView }) {
  const { db } = useApp()
  const navigate = useNavigate()
  const rejected = useLiveQuery(
    async () => (await db.rejectedEvents.where('matchId').equals(view.match.id).sortBy('seq')).map((r) => r.event),
    [db, view.match.id],
  )
  const nameOf = (id: string) => view.playersById.get(id)?.name ?? 'Jugador'
  const lines = rejected ? describeRejectedEvents(rejected, nameOf) : []

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
      <Button onClick={() => navigate('/partidos', { replace: true })}>VOLVER A PARTIDOS</Button>
    </main>
  )
}
