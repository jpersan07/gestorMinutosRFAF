import type { PlayerRecord } from '../../data'
import { getFormation, type Half, type Id, type MatchSummary } from '../../domain'

interface Props {
  readonly summary: MatchSummary
  readonly playersById: ReadonlyMap<Id, PlayerRecord>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-sm font-bold tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  )
}

/** Resumen calculado a partir de los eventos: minutos, cambios y alineaciones. */
export function MatchSummaryView({ summary, playersById }: Props) {
  const name = (id: Id) => playersById.get(id)?.name ?? 'Jugador eliminado'
  const number = (id: Id) => playersById.get(id)?.number
  const minutes = [...summary.minutes].sort(
    (a, b) => b.minutesPlayed - a.minutesPlayed || name(a.playerId).localeCompare(name(b.playerId), 'es'),
  )
  const halftime = summary.halftimeChanges
  const halftimeHasChanges = halftime && (halftime.out.length > 0 || halftime.in.length > 0)
  const startingLineup = summary.lineups[1]

  return (
    <>
      <Section title="MINUTOS">
        <ul className="flex flex-col divide-y divide-panel-strong rounded-xl bg-panel">
          {minutes.map((p) => (
            <li key={p.playerId} className="flex min-h-12 items-center gap-3 px-4">
              <span className="tabular w-7 text-center font-black text-muted">{number(p.playerId)}</span>
              <span className="flex-1 truncate text-lg font-semibold">{name(p.playerId)}</span>
              <span className="tabular text-xl font-black">{p.minutesPlayed}'</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="CAMBIOS">
        {summary.substitutions.length === 0 && !halftimeHasChanges ? (
          <p className="rounded-xl bg-panel p-4 text-muted">Sin cambios.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-panel-strong rounded-xl bg-panel">
            {summary.substitutions
              .filter((s) => s.half === 1)
              .map((s) => (
                <li key={s.id} className="px-4 py-3 text-lg">
                  <span className="tabular font-black">{s.minute}'</span> {name(s.outPlayerId)} → {name(s.inPlayerId)}
                </li>
              ))}
            {halftimeHasChanges && (
              <li className="px-4 py-3 text-lg">
                <span className="tabular font-black">45'</span> <span className="text-muted">Descanso:</span>{' '}
                {halftime.out.length > 0 && <>salen {halftime.out.map(name).join(', ')}</>}
                {halftime.out.length > 0 && halftime.in.length > 0 && ' · '}
                {halftime.in.length > 0 && <>entran {halftime.in.map(name).join(', ')}</>}
              </li>
            )}
            {summary.substitutions
              .filter((s) => s.half === 2)
              .map((s) => (
                <li key={s.id} className="px-4 py-3 text-lg">
                  <span className="tabular font-black">{s.minute}'</span> {name(s.outPlayerId)} → {name(s.inPlayerId)}
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title="ALINEACIÓN">
        <div className="flex flex-col gap-3 rounded-xl bg-panel p-4">
          {([1, 2] as Half[]).map((half) => (
            <p key={half} className="font-semibold">
              FORMACIÓN {half}ª PARTE: <strong>{summary.formations[half] ?? '—'}</strong>
            </p>
          ))}
          {startingLineup && (
            <>
              <p className="pt-2 text-sm font-bold tracking-wide text-muted">ALINEACIÓN INICIAL</p>
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {getFormation(startingLineup.formationId).slots.map((slot) => {
                  const playerId = startingLineup.slots[slot.id]
                  return (
                    <li key={slot.id} className="flex gap-3">
                      <span className="w-10 text-sm font-bold text-muted">{slot.label}</span>
                      <span>{playerId ? name(playerId) : '—'}</span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </Section>
    </>
  )
}
