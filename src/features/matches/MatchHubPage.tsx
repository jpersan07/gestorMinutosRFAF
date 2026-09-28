import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router'
import { useApp } from '../../app/context'
import { useCrest } from '../../app/useCrest'
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

      <nav aria-label="Acciones del partido" className="flex flex-col gap-3">
        {canEditMatchDetails(match.status) && (
          <Button variant="secondary" onClick={() => navigate(`/partidos/${match.id}/editar`)}>
            EDITAR
          </Button>
        )}
      </nav>
    </Page>
  )
}
