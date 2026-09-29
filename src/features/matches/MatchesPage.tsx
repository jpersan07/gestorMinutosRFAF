import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../app/auth/AuthContext'
import { useApp, useCoachId } from '../../app/context'
import { useAction } from '../../app/useAction'
import { useCrest } from '../../app/useCrest'
import { listMatches, type MatchRecord } from '../../data'
import { loadDemoData } from '../../data/demo'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
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
  const { db, env, scope } = useApp()
  const { signOut } = useAuth()
  const coachId = useCoachId()
  const navigate = useNavigate()
  const { run } = useAction()
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const profile = useLiveQuery(() => db.profiles.get(coachId), [db, coachId])
  const team = useLiveQuery(() => db.teams.get(scope.teamId), [db, scope.teamId])
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
      <div className="flex items-center justify-between gap-3 text-sm text-muted">
        <span className="min-w-0 truncate">
          <strong className="text-line">{profile?.displayName}</strong>
          {team ? ` · ${team.name}` : ''}
        </span>
        <button
          type="button"
          className="min-h-11 shrink-0 px-2 font-bold underline"
          onClick={() => setConfirmSignOut(true)}
        >
          CERRAR SESIÓN
        </button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="¿Cerrar sesión?"
        confirmLabel="CERRAR SESIÓN"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false)
          void signOut()
        }}
      >
        <p>Los datos de este móvil se conservan y volverán a estar disponibles al entrar con tu cuenta.</p>
      </ConfirmDialog>

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
