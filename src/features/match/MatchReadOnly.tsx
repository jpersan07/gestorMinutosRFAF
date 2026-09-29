import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../../app/context'
import type { MatchView } from '../../app/match/useMatch'
import { clockMinute, formatClock, getFormation, matchSecondAt } from '../../domain'
import { Pitch } from '../../ui/Pitch'
import { PitchSlot } from '../../ui/PitchSlot'

const PHASE: Record<string, string> = {
  scheduled: 'PENDIENTE',
  setup: 'EN PREPARACIÓN',
  first_half: 'PRIMERA PARTE',
  halftime: 'DESCANSO',
  second_half: 'SEGUNDA PARTE',
  finished: 'FINALIZADO',
  saved: 'GUARDADO',
}

/**
 * El partido tal como está (estado oficial descargado), SOLO LECTURA: estado, reloj, jugadores
 * en el campo, cambios y resultado. No hay nada que pulsar: desde aquí no se genera ningún evento.
 */
export function MatchReadOnly({ view, now }: { view: MatchView; now: number }) {
  const { db } = useApp()
  const { state, playersById } = view
  const report = useLiveQuery(() => db.matchReports.get(view.match.id), [db, view.match.id])
  const formation = state.currentFormationId ? getFormation(state.currentFormationId) : null
  const name = (id: string) => playersById.get(id)?.name ?? 'Jugador'
  const started = state.status !== 'scheduled' && state.status !== 'setup'

  return (
    <section aria-label="Estado del partido" className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1 rounded-2xl bg-panel p-4 text-center">
        <p className="text-lg font-black uppercase">{view.match.opponent}</p>
        <p className="text-sm font-bold tracking-[0.2em] text-muted">{PHASE[state.status]}</p>
        {started && (
          <p role="timer" aria-label="Cronómetro (solo consulta)" className="tabular text-5xl font-black leading-none">
            {formatClock(matchSecondAt(state, now))}
          </p>
        )}
        {!started && <p className="font-semibold">El otro dispositivo está preparando el partido ({view.squad.length} convocados).</p>}
        {report?.result && <p className="text-lg font-black">Resultado: {report.result}</p>}
      </div>

      {started && formation && (
        <div role="list" aria-label="En el campo" className="mx-auto w-full max-w-xs">
          <Pitch className="w-full">
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
                  readOnly
                />
              )
            })}
          </Pitch>
        </div>
      )}

      {started && (
        <div className="flex flex-col gap-2 rounded-2xl bg-panel p-4">
          <h2 className="font-black">CAMBIOS</h2>
          {state.substitutions.length === 0 ? (
            <p className="text-muted">Sin cambios todavía.</p>
          ) : (
            <ul aria-label="Cambios del partido" className="flex flex-col gap-1 font-semibold">
              {state.substitutions.map((sub) => (
                <li key={sub.id} className={sub.undone ? 'text-muted line-through' : ''}>
                  {clockMinute(sub.matchSecond)}' {name(sub.outPlayerId)} → {name(sub.inPlayerId)}
                  {sub.undone ? ' (deshecho)' : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
