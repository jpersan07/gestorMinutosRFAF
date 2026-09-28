import { Navigate, useParams } from 'react-router'
import { useMatch } from '../../app/match/useMatch'
import { Page } from '../../ui/Page'
import { SetupScreen } from './SetupScreen'
import { TakeControl } from './TakeControl'

/** Pantalla de partido: su contenido es una función del estado del motor. */
export function MatchScreen() {
  const { matchId = '' } = useParams()
  const view = useMatch(matchId)

  if (view === undefined) return null
  if (view === null) {
    return (
      <Page title="PARTIDO" back="/partidos">
        <p className="text-muted">No se ha encontrado el partido.</p>
      </Page>
    )
  }

  const { status } = view.state
  if (status === 'finished' || status === 'saved') return <Navigate to={`/partidos/${matchId}`} replace />
  if (!view.isController) return <TakeControl view={view} />

  switch (status) {
    case 'scheduled':
    case 'setup':
      return <SetupScreen view={view} />
    case 'first_half':
    case 'halftime':
    case 'second_half':
      return (
        <Page title="PARTIDO" back={`/partidos/${matchId}`}>
          <p className="rounded-xl bg-panel p-4 text-lg font-bold">Partido en juego.</p>
        </Page>
      )
  }
}
