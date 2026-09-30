import { useState } from 'react'
import { useApp, useCoachId } from '../../app/context'
import type { MatchView } from '../../app/match/useMatch'
import { errorMessage } from '../../app/messages'
import { useAction } from '../../app/useAction'
import { advanceTestClock, goToFullTime, goToHalftime, type DataResult } from '../../data'
import type { MatchState } from '../../domain'
import { Button } from '../../ui/Button'

const MIN = 60_000

/** Aviso visible de que el partido está en MODO PRUEBAS (no es un partido real). */
export function TestModeBadge() {
  return (
    <span className="rounded-lg bg-warn px-2 py-0.5 text-xs font-black tracking-wider text-accent-ink">
      🧪 MODO PRUEBAS
    </span>
  )
}

/**
 * Controles del MODO PRUEBAS (solo equipo DEMO, activado antes de PLAY): adelantan el reloj del
 * partido; los finales de parte, el descanso y la 2ª parte se registran con los comandos normales.
 */
export function TestModePanel({ view }: { view: MatchView }) {
  const { db, env, scope } = useApp()
  const coachId = useCoachId()
  const { run, busy, unexpected } = useAction()
  const [error, setError] = useState<string | null>(null)
  if (!view.testMode || !view.isController || view.match.controlLostAt) return null

  const actor = { deviceId: scope.deviceId, coachId }
  const status = view.state.status
  async function act(action: () => Promise<DataResult<MatchState>>) {
    setError(null)
    const result = await run(action, { at: 'testMode' })
    if (result && !result.ok) setError(errorMessage(result.error))
  }
  const advance = (ms: number) => act(() => advanceTestClock(db, env, view.match.id, actor, ms))

  return (
    <section aria-label="Modo pruebas" className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-warn p-2">
      <p className="text-center text-sm font-black text-warn">🧪 MODO PRUEBAS · reloj adelantado</p>
      <div className="grid grid-cols-3 gap-2">
        <Button size="md" variant="secondary" disabled={busy} onClick={() => void advance(MIN)}>
          +1:00
        </Button>
        <Button size="md" variant="secondary" disabled={busy} onClick={() => void advance(5 * MIN)}>
          +5:00
        </Button>
        <Button size="md" variant="secondary" disabled={busy} onClick={() => void advance(10 * MIN)}>
          +10:00
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="md"
          variant="secondary"
          disabled={busy || status !== 'first_half'}
          onClick={() => void act(() => goToHalftime(db, env, view.match.id, actor))}
        >
          IR A DESCANSO
        </Button>
        <Button
          size="md"
          variant="secondary"
          disabled={busy}
          onClick={() => void act(() => goToFullTime(db, env, view.match.id, actor))}
        >
          IR A 90:00
        </Button>
      </div>
      {(error ?? unexpected) && (
        <p role="alert" className="text-center text-sm font-bold text-danger">
          {error ?? unexpected}
        </p>
      )}
    </section>
  )
}
