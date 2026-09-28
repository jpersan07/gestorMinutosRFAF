import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router'
import { useApp, useCoachId } from '../../app/context'
import { useAction } from '../../app/useAction'
import { useCrest } from '../../app/useCrest'
import { listMatches, type MatchRecord } from '../../data'
import { loadDemoData } from '../../data/demo'
import { Button } from '../../ui/Button'
import { Crest } from '../../ui/Crest'
import { Page } from '../../ui/Page'
import { StatusBadge } from '../../ui/StatusBadge'
import { matchDetailsLine } from './matchDetails'

function MatchCard({ match }: { match: MatchRecord }) {
  const crest = useCrest(match.crestId)
  return (
    <li>
      <Link
        to={`/partidos/${match.id}`}
        className="flex items-center gap-4 rounded-2xl bg-panel p-4 active:bg-panel-strong"
      >
        <Crest dataUrl={crest} name={match.opponent} size={52} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-lg font-black uppercase">{match.opponent}</span>
          <span className="truncate text-sm text-muted">{matchDetailsLine(match)}</span>
          <span>
            <StatusBadge status={match.status} />
          </span>
        </span>
        <span className="text-sm font-bold text-accent">ENTRAR →</span>
      </Link>
    </li>
  )
}

export function MatchesPage() {
  const { db, env, scope, selectCoach } = useApp()
  const coachId = useCoachId()
  const navigate = useNavigate()
  const { run } = useAction()
  const coach = useLiveQuery(() => db.coaches.get(coachId), [db, coachId])
  const matches = useLiveQuery(() => listMatches(db, scope.seasonId), [db, scope.seasonId])

  return (
    <Page
      title="PARTIDOS"
      actions={
        <Link to="/jugadores" className="rounded-xl bg-panel-strong px-3 py-3 text-sm font-bold">
          JUGADORES
        </Link>
      }
    >
      <div className="flex items-center justify-between text-sm text-muted">
        <span>
          Entrenador: <strong className="text-line">{coach?.name}</strong>
        </span>
        <button
          type="button"
          className="min-h-11 px-2 font-bold underline"
          onClick={async () => {
            await selectCoach(null)
            navigate('/quien', { replace: true })
          }}
        >
          Cambiar
        </button>
      </div>

      <Button onClick={() => navigate('/partidos/nuevo')}>+ NUEVO PARTIDO</Button>

      {matches && matches.length === 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-panel p-4 text-muted">
          <p>
            Todavía no hay partidos. Crea el primero con <strong>NUEVO PARTIDO</strong>.
          </p>
          {import.meta.env.DEV && (
            <Button variant="secondary" size="md" onClick={() => void run(() => loadDemoData(db, env, scope))}>
              CARGAR DATOS DEMO (solo desarrollo)
            </Button>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {matches?.map((match) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </ul>
    </Page>
  )
}
