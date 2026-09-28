import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router'
import { useApp } from '../../app/context'
import { useCrest } from '../../app/useCrest'
import { canEditMatchDetails } from '../../domain'
import { Page } from '../../ui/Page'
import { MatchForm } from './MatchForm'

/** EDITAR: rival, escudo, fecha, hora y ubicación, hasta pulsar PLAY. */
export function EditMatchPage() {
  const { matchId = '' } = useParams()
  const { db } = useApp()
  const navigate = useNavigate()
  const match = useLiveQuery(async () => (await db.matches.get(matchId)) ?? null, [db, matchId])
  const crest = useCrest(match?.crestId ?? null)
  const crestReady = useLiveQuery(
    async () => (match?.crestId ? Boolean(await db.crests.get(match.crestId)) : true),
    [db, match?.crestId],
  )
  const back = `/partidos/${matchId}`

  return (
    <Page title="EDITAR PARTIDO" back={back}>
      {match === undefined || crestReady === undefined ? null : match === null ? (
        <p className="text-muted">No se ha encontrado el partido.</p>
      ) : !canEditMatchDetails(match.status) ? (
        <p className="rounded-xl bg-panel p-4 font-semibold">
          El partido ya ha empezado: rival, escudo, fecha, hora y ubicación están bloqueados.
        </p>
      ) : (
        <MatchForm
          key={match.id}
          match={match}
          currentCrest={crest}
          onSaved={() => navigate(back, { replace: true })}
        />
      )}
    </Page>
  )
}
