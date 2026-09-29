import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router'
import { useApp } from '../../app/context'
import { isLive } from '../../app/matchStatus'
import { useCrest } from '../../app/useCrest'
import { getSquad } from '../../data'
import { canEditMatchDetails } from '../../domain'
import { Button } from '../../ui/Button'
import { Crest } from '../../ui/Crest'
import { Page } from '../../ui/Page'
import { StatusBadge } from '../../ui/StatusBadge'
import { matchDetailsLine } from './matchDetails'

/** Ficha del partido: información, estado y las acciones que tocan según el estado. */
export function MatchHubPage() {
  const { matchId = '' } = useParams()
  const { db } = useApp()
  const navigate = useNavigate()
  const match = useLiveQuery(async () => (await db.matches.get(matchId)) ?? null, [db, matchId])
  const crest = useCrest(match?.crestId ?? null)
  const squad = useLiveQuery(() => getSquad(db, matchId), [db, matchId])
  const squadRecord = useLiveQuery(() => db.matchSquads.get(matchId), [db, matchId])
  const rejectedCount = useLiveQuery(() => db.rejectedEvents.where('matchId').equals(matchId).count(), [db, matchId], 0)

  if (match === undefined) return null
  if (match === null) {
    return (
      <Page title="PARTIDO" back="/partidos">
        <p className="text-muted">No se ha encontrado el partido.</p>
      </Page>
    )
  }

  return (
    <Page title="PARTIDO" back="/partidos">
      <section className="flex flex-col items-center gap-3 rounded-2xl bg-panel p-5 text-center">
        <Crest dataUrl={crest} name={match.opponent} size={88} />
        <h2 className="text-2xl font-black uppercase">{match.opponent}</h2>
        <p className="text-muted">{matchDetailsLine(match)}</p>
        <StatusBadge status={match.status} />
      </section>

      {match.controlLostAt && (
        <p role="alert" className="rounded-xl bg-warn p-4 font-bold text-accent-ink">
          Controlado por otro dispositivo: otro móvil ha tomado el control de este partido. Los cambios hechos aquí sin
          conexión no se han aplicado.
        </p>
      )}
      {!match.controlLostAt && rejectedCount > 0 && (
        <p role="alert" className="rounded-xl bg-warn p-4 font-bold text-accent-ink">
          El servidor no ha aceptado parte de este partido ({rejectedCount === 1 ? '1 cambio' : `${rejectedCount} cambios`}).
          Se han apartado y no cuentan para los minutos.
        </p>
      )}
      {(match.syncState === 'conflict' || squadRecord?.syncState === 'conflict') && (
        <p role="alert" className="rounded-xl bg-warn p-4 font-bold text-accent-ink">
          No se han podido guardar en el servidor los cambios de este partido
          {squadRecord?.syncState === 'conflict' && match.syncState !== 'conflict' ? ' (convocatoria)' : ''}: otro
          dispositivo ya lo ha empezado. En el servidor se mantienen los datos anteriores.
        </p>
      )}

      <nav aria-label="Acciones del partido" className="flex flex-col gap-3">
        {canEditMatchDetails(match.status) && (
          <Button onClick={() => navigate(`/partidos/${match.id}/juego`)}>PREPARAR ALINEACIÓN</Button>
        )}
        {isLive(match.status) && (
          <Button className="min-h-16 text-xl" onClick={() => navigate(`/partidos/${match.id}/juego`)}>
            CONTINUAR PARTIDO
          </Button>
        )}
        {canEditMatchDetails(match.status) && (
          <Button variant="secondary" onClick={() => navigate(`/partidos/${match.id}/editar`)}>
            EDITAR
          </Button>
        )}
        {(match.status === 'finished' || match.status === 'saved') && (
          <Button variant={match.status === 'finished' ? 'primary' : 'secondary'} onClick={() => navigate(`/partidos/${match.id}/resumen`)}>
            {match.status === 'finished' ? 'RESUMEN E INFORME' : 'RESUMEN'}
          </Button>
        )}
        <Button variant="secondary" onClick={() => navigate(`/partidos/${match.id}/convocatoria`)}>
          {squad ? `CONVOCATORIA · ${squad.length}` : 'CONVOCATORIA'}
        </Button>
      </nav>
    </Page>
  )
}
