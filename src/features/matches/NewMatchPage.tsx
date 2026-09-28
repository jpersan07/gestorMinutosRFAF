import { useNavigate } from 'react-router'
import { Page } from '../../ui/Page'
import { MatchForm } from './MatchForm'

export function NewMatchPage() {
  const navigate = useNavigate()
  return (
    <Page title="NUEVO PARTIDO" back="/partidos">
      <MatchForm match={null} currentCrest={null} onSaved={(match) => navigate(`/partidos/${match.id}`, { replace: true })} />
    </Page>
  )
}
