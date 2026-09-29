import { useState } from 'react'
import { useMatchDispatch, type MatchView } from '../../app/match/useMatch'
import { SessionLostNotice } from '../../app/routing/SessionLostBanner'
import { OfflineNotice } from '../../app/sync/ConnectionNotice'
import { errorMessage } from '../../app/messages'
import { useAction } from '../../app/useAction'
import { secondHalfAvailableAt } from '../../domain'
import { Button } from '../../ui/Button'
import { Page } from '../../ui/Page'
import { LineupStep } from './LineupStep'

function ContinueButton({ view, now, confirmed }: { view: MatchView; now: number; confirmed: boolean }) {
  const dispatch = useMatchDispatch(view.match.id)
  const { run, busy, unexpected } = useAction()
  const [error, setError] = useState<string | null>(null)
  const availableAt = secondHalfAvailableAt(view.state) ?? now
  const waitSeconds = Math.max(0, Math.ceil((availableAt - now) / 1000))

  return (
    <div className="flex flex-col gap-2">
      {waitSeconds > 0 && (
        <p aria-live="polite" className="rounded-xl bg-panel p-3 text-center font-bold text-warn">
          Preparando segunda parte… <span className="tabular">{waitSeconds}</span> s
        </p>
      )}
      {(error ?? unexpected) && <p className="font-semibold text-danger">{error ?? unexpected}</p>}
      <Button
        className="min-h-16 text-xl"
        disabled={!confirmed || waitSeconds > 0 || busy}
        onClick={async () => {
          const result = await run(() => dispatch({ type: 'START_SECOND_HALF' }))
          if (result && !result.ok) setError(errorMessage(result.error))
        }}
      >
        ▶ CONTINUAR
      </Button>
    </div>
  )
}

/**
 * DESCANSO: sin cambios. Se configura la 2ª parte (formación, jugadores y posiciones
 * pueden cambiar) y se continúa cuando está confirmada y han pasado 15 s.
 */
export function HalftimePanel({ view, now }: { view: MatchView; now: number }) {
  const [configuring, setConfiguring] = useState(false)
  const confirmed = Boolean(view.state.lineups[2])

  return (
    <Page title="DESCANSO" back={`/partidos/${view.match.id}`}>
      <SessionLostNotice />
      <OfflineNotice />
      <section className="flex flex-col items-center gap-1 rounded-2xl bg-panel p-4 text-center">
        <p className="text-lg font-black uppercase">{view.match.opponent}</p>
        <p className="tabular text-5xl font-black">45:00</p>
        <p className="font-semibold">Primera parte finalizada.</p>
        {!confirmed && <p className="text-muted">Debes confirmar la alineación de la segunda parte.</p>}
      </section>

      {configuring ? (
        <LineupStep
          view={view}
          half={2}
          renderStart={(isConfirmed) => <ContinueButton view={view} now={now} confirmed={isConfirmed} />}
        />
      ) : (
        <>
          <Button variant={confirmed ? 'secondary' : 'primary'} onClick={() => setConfiguring(true)}>
            {confirmed ? 'REVISAR 2ª PARTE' : 'CONFIGURAR 2ª PARTE'}
          </Button>
          {confirmed && (
            <>
              <p className="rounded-xl bg-panel p-3 text-center font-black text-accent">✓ 2ª PARTE CONFIRMADA</p>
              <ContinueButton view={view} now={now} confirmed />
            </>
          )}
          {!confirmed && <ContinueButton view={view} now={now} confirmed={false} />}
        </>
      )}
    </Page>
  )
}
