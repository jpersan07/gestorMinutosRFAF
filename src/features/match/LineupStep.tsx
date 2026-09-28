import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import { useApp } from '../../app/context'
import { useMatchDispatch, type MatchView } from '../../app/match/useMatch'
import { errorMessage } from '../../app/messages'
import { useAction } from '../../app/useAction'
import { getLineupDraft, saveLineupDraft } from '../../data'
import { lineupOnField, missingSlots, sameLineup, type Half, type Lineup } from '../../domain'
import { Button } from '../../ui/Button'
import { LineupEditor } from './LineupEditor'

interface LineupStepProps {
  readonly view: MatchView
  readonly half: Half
  /** Botón de arranque (COMENZAR / CONTINUAR) según si la alineación está confirmada. */
  readonly renderStart: (confirmed: boolean) => ReactNode
}

function LineupStepForm({ view, half, renderStart, initialDraft }: LineupStepProps & { initialDraft: Lineup | null }) {
  const { db, env } = useApp()
  const dispatch = useMatchDispatch(view.match.id)
  const { run, busy, unexpected } = useAction()
  const [draft, setDraft] = useState<Lineup | null>(initialDraft)
  const [error, setError] = useState<string | null>(null)

  const confirmed = draft !== null && sameLineup(draft, view.state.lineups[half])
  const missing = draft ? missingSlots(draft).length : 11

  function change(next: Lineup) {
    setDraft(next)
    setError(null)
    void run(async () => {
      await saveLineupDraft(db, env, view.match.id, half, next)
      // Elegir formación por primera vez pone el partido "En preparación" y este móvil lo controla.
      if (view.state.status === 'scheduled') await dispatch({ type: 'START_SETUP' })
    })
  }

  async function confirm() {
    if (!draft) return
    const result = await run(() => dispatch({ type: 'CONFIRM_LINEUP', lineup: draft }))
    if (result && !result.ok) setError(errorMessage(result.error))
  }

  return (
    <div className="flex flex-col gap-4">
      <LineupEditor lineup={draft} players={view.squad} onChange={change} />

      <div aria-live="polite" className="flex flex-col gap-3">
        {draft && missing > 0 && (
          <p className="rounded-xl bg-panel p-3 text-center font-bold text-warn">
            La alineación está incompleta. {missing === 1 ? 'Falta 1 posición.' : `Faltan ${missing} posiciones.`}
          </p>
        )}
        {confirmed && (
          <p className="rounded-xl bg-panel p-3 text-center font-black text-accent">✓ ALINEACIÓN CONFIRMADA</p>
        )}
        {(error ?? unexpected) && <p className="font-semibold text-danger">{error ?? unexpected}</p>}
      </div>

      {!confirmed && (
        <Button variant="secondary" disabled={busy || !draft || missing > 0} onClick={() => void confirm()}>
          CONFIRMAR ALINEACIÓN
        </Button>
      )}
      {renderStart(confirmed)}
    </div>
  )
}

/** Carga el borrador guardado (o la alineación confirmada / la del campo) antes de editar. */
export function LineupStep(props: LineupStepProps) {
  const { db } = useApp()
  const { view, half } = props
  const saved = useLiveQuery(() => getLineupDraft(db, view.match.id, half), [db, view.match.id, half], 'loading' as const)
  if (saved === 'loading') return null
  const initial =
    saved ?? view.state.lineups[half] ?? (half === 2 ? lineupOnField(view.state) : null)
  return <LineupStepForm key={`${view.match.id}-${half}`} {...props} initialDraft={initial} />
}
