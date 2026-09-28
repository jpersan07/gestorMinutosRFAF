import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router'
import { useApp, useCoachId } from '../../app/context'
import { Page } from '../../ui/Page'

export function MatchesPage() {
  const { db, selectCoach } = useApp()
  const coachId = useCoachId()
  const navigate = useNavigate()
  const coach = useLiveQuery(() => db.coaches.get(coachId), [db, coachId])

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
    </Page>
  )
}
