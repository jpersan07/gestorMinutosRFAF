import { useState } from 'react'
import { Link } from 'react-router'
import { useMatchDispatch, type MatchView } from '../../app/match/useMatch'
import { errorMessage } from '../../app/messages'
import { useAction } from '../../app/useAction'
import type { PlayerRecord } from '../../data'
import {
  benchPlayers,
  clockMinute,
  computeMinutes,
  formatClock,
  getFormation,
  lastUndoableSubstitution,
  matchSecondAt,
} from '../../domain'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Pitch } from '../../ui/Pitch'
import { PitchSlot } from '../../ui/PitchSlot'
import { SubstitutionFlow } from './SubstitutionFlow'

/** Parte en juego: cronómetro, campo y cambios. Pensada para una mano y en vertical. */
export function LivePanel({ view, now }: { view: MatchView; now: number }) {
  const { state, match, playersById } = view
  const dispatch = useMatchDispatch(match.id)
  const { run, busy, unexpected } = useAction()
  const [outgoing, setOutgoing] = useState<{ player: PlayerRecord; slotLabel: string } | null>(null)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const second = matchSecondAt(state, now)
  const formation = state.currentFormationId ? getFormation(state.currentFormationId) : null
  const minutesById = new Map(
    computeMinutes(view.events, { untilSecond: second }).map((p) => [p.playerId, p.minutesPlayed]),
  )
  const bench = benchPlayers(state).flatMap((id) => playersById.get(id) ?? [])
  const lastSub = lastUndoableSubstitution(state)
  const name = (id: string) => playersById.get(id)?.name ?? '—'

  async function send(command: Parameters<typeof dispatch>[0]) {
    setError(null)
    const result = await run(() => dispatch(command), { command: command.type })
    if (result && !result.ok) setError(errorMessage(result.error))
  }

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] gap-2 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))] [grid-template-areas:'top''pitch''bottom'] landscape:grid-cols-[minmax(0,1fr)_minmax(0,42%)] landscape:grid-rows-[auto_minmax(0,1fr)] landscape:[grid-template-areas:'pitch_top''pitch_bottom']">
      <header className="flex flex-col items-center [grid-area:top]">
        <div className="flex w-full items-center gap-2">
          <Link
            to={`/partidos/${match.id}`}
            aria-label="Volver"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl active:bg-panel"
          >
            ←
          </Link>
          <p className="min-w-0 flex-1 truncate text-center text-lg font-black uppercase">{match.opponent}</p>
          <span className="w-11" />
        </div>
        <p className="text-sm font-bold tracking-[0.2em] text-muted">
          {state.status === 'first_half' ? 'PRIMERA PARTE' : 'SEGUNDA PARTE'}
        </p>
        <p role="timer" aria-label="Cronómetro" className="tabular text-7xl font-black leading-none">
          {formatClock(second)}
        </p>
      </header>

      <div className="flex min-h-0 items-center justify-center [container-type:size] [grid-area:pitch]">
        {formation && (
          <Pitch className="w-[min(100cqw,68cqh)]">
            {formation.slots.map((slot) => {
              const playerId = state.onField[slot.id]
              const player = playerId ? playersById.get(playerId) : undefined
              return (
                <PitchSlot
                  key={slot.id}
                  x={slot.x}
                  y={slot.y}
                  role={slot.label}
                  player={player}
                  ariaLabel={`${slot.label}: ${player?.name ?? 'vacía'}`}
                  onClick={player ? () => setOutgoing({ player, slotLabel: slot.label }) : undefined}
                />
              )
            })}
          </Pitch>
        )}
      </div>

      <footer className="flex flex-col gap-2 [grid-area:bottom] landscape:justify-end">
        {(error ?? unexpected) && (
          <p role="alert" className="rounded-xl bg-danger px-3 py-2 font-bold text-danger-ink">
            {error ?? unexpected}
          </p>
        )}
        {lastSub ? (
          <div className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2">
            <p className="min-w-0 flex-1 truncate font-semibold">
              <span className="tabular">{clockMinute(lastSub.matchSecond)}'</span> {name(lastSub.outPlayerId)} →{' '}
              {name(lastSub.inPlayerId)}
            </p>
            <Button size="md" variant="secondary" disabled={busy} onClick={() => setConfirmUndo(true)}>
              DESHACER
            </Button>
          </div>
        ) : (
          <p className="py-2 text-center text-sm text-muted">Toca un jugador para hacer un cambio.</p>
        )}
      </footer>

      <SubstitutionFlow
        outgoing={outgoing}
        bench={bench}
        minutesById={minutesById}
        matchSecond={second}
        busy={busy}
        onCancel={() => setOutgoing(null)}
        onConfirm={(incoming) => {
          if (!outgoing) return
          void send({ type: 'SUBSTITUTE', outPlayerId: outgoing.player.id, inPlayerId: incoming.id })
          setOutgoing(null)
        }}
      />

      <ConfirmDialog
        open={confirmUndo && lastSub !== undefined}
        title="¿Deshacer el cambio?"
        confirmLabel="DESHACER"
        variant="danger"
        busy={busy}
        onCancel={() => setConfirmUndo(false)}
        onConfirm={() => {
          setConfirmUndo(false)
          void send({ type: 'UNDO_LAST_SUBSTITUTION' })
        }}
      >
        {lastSub && (
          <p>
            {clockMinute(lastSub.matchSecond)}' {name(lastSub.outPlayerId)} → {name(lastSub.inPlayerId)}. Se anulará
            como si no se hubiera hecho (queda registrado en el historial).
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}
