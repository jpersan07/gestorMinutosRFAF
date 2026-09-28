import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useApp, useCoachId } from '../../app/context'
import { useMatchDispatch, type MatchView } from '../../app/match/useMatch'
import { errorMessage } from '../../app/messages'
import { useAction } from '../../app/useAction'
import { listPlayers, saveSquad } from '../../data'
import { PLAYERS_ON_FIELD } from '../../domain'
import { Button } from '../../ui/Button'
import { Page } from '../../ui/Page'
import { LineupStep } from './LineupStep'

function NoSquad({ view }: { view: MatchView }) {
  const { db, env } = useApp()
  const coachId = useCoachId()
  const navigate = useNavigate()
  const { run, busy, unexpected } = useAction()
  const convocatoria = `/partidos/${view.match.id}/convocatoria`

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-panel p-4">
      <p className="text-lg font-bold">No hay convocatoria para este partido.</p>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const active = (await listPlayers(db, view.match.teamId)).filter((p) => p.active)
            await saveSquad(db, env, view.match.id, active.map((p) => p.id), coachId)
          })
        }
      >
        CONVOCAR A TODOS
      </Button>
      <Button variant="secondary" onClick={() => navigate(convocatoria)}>
        ELEGIR CONVOCADOS
      </Button>
      {unexpected && <p className="font-semibold text-danger">{unexpected}</p>}
    </div>
  )
}

/** Antes de PLAY: formación, alineación, confirmación y ▶ COMENZAR. */
export function SetupScreen({ view }: { view: MatchView }) {
  const navigate = useNavigate()
  const dispatch = useMatchDispatch(view.match.id)
  const { run, busy, unexpected } = useAction()
  const [error, setError] = useState<string | null>(null)
  const hub = `/partidos/${view.match.id}`

  return (
    <Page title="ALINEACIÓN" back={hub}>
      <p className="text-lg font-black uppercase">{view.match.opponent}</p>
      {view.squad.length === 0 ? (
        <NoSquad view={view} />
      ) : (
        <>
          {view.squad.length < PLAYERS_ON_FIELD && (
            <p className="rounded-xl bg-panel p-3 font-semibold text-warn">
              Solo hay {view.squad.length} convocados: hacen falta al menos {PLAYERS_ON_FIELD}.{' '}
              <button type="button" className="underline" onClick={() => navigate(`${hub}/convocatoria`)}>
                Ir a la convocatoria
              </button>
            </p>
          )}
          <LineupStep
            view={view}
            half={1}
            renderStart={(confirmed) => (
              <>
                {(error ?? unexpected) && <p className="font-semibold text-danger">{error ?? unexpected}</p>}
                <Button
                  className="min-h-16 text-xl"
                  disabled={!confirmed || busy}
                  onClick={async () => {
                    const result = await run(() => dispatch({ type: 'START_MATCH' }))
                    if (result && !result.ok) setError(errorMessage(result.error))
                  }}
                >
                  {confirmed ? '▶ COMENZAR' : '▶'}
                </Button>
              </>
            )}
          />
        </>
      )}
    </Page>
  )
}
