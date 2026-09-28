import { clockMinute, matchSecondAt } from '../match/clock'
import { replay } from '../match/engine'
import { orderEvents, type MatchEvent } from '../match/events'
import type { EpochMs, FormationId, Half, Id, Lineup, MatchSecond, MatchStatus } from '../types'
import { computeMinutes, type PlayerMinutes } from './minutes'

export interface SubstitutionEntry {
  readonly id: Id
  readonly half: Half
  readonly matchSecond: MatchSecond
  /** Minuto visible: 57:23 → 57. */
  readonly minute: number
  readonly outPlayerId: Id
  readonly inPlayerId: Id
}

/** Cambios hechos al confirmar la alineación de la 2ª parte (efectivos en el 45'). */
export interface HalftimeChanges {
  readonly out: readonly Id[]
  readonly in: readonly Id[]
}

export interface MatchSummary {
  readonly status: MatchStatus
  readonly lineups: Readonly<Partial<Record<Half, Lineup>>>
  readonly formations: Readonly<Partial<Record<Half, FormationId>>>
  /** Cambios en juego, sin los anulados, en orden cronológico. */
  readonly substitutions: readonly SubstitutionEntry[]
  readonly halftimeChanges: HalftimeChanges | null
  readonly minutes: readonly PlayerMinutes[]
}

/** Todo lo que muestra la pantalla de resumen, calculado solo a partir de los eventos. */
export function buildMatchSummary(matchId: Id, events: readonly MatchEvent[], now: EpochMs): MatchSummary {
  const ordered = orderEvents(events)
  const state = replay(matchId, ordered)

  const formations: Partial<Record<Half, FormationId>> = {}
  if (state.lineups[1]) formations[1] = state.lineups[1].formationId
  if (state.lineups[2]) formations[2] = state.lineups[2].formationId

  const substitutions = state.substitutions
    .filter((sub) => !sub.undone)
    .map((sub) => ({
      id: sub.id,
      half: sub.half,
      matchSecond: sub.matchSecond,
      minute: clockMinute(sub.matchSecond),
      outPlayerId: sub.outPlayerId,
      inPlayerId: sub.inPlayerId,
    }))

  return {
    status: state.status,
    lineups: state.lineups,
    formations,
    substitutions,
    halftimeChanges: halftimeChanges(matchId, ordered),
    minutes: computeMinutes(ordered, { untilSecond: matchSecondAt(state, now) }),
  }
}

function halftimeChanges(matchId: Id, ordered: readonly MatchEvent[]): HalftimeChanges | null {
  const firstHalfEnd = ordered.find((e) => e.type === 'HALF_ENDED' && e.half === 1)
  const secondHalfStart = ordered.find((e) => e.type === 'HALF_STARTED' && e.half === 2)
  if (!firstHalfEnd || !secondHalfStart) return null

  const atHalftime = replay(matchId, ordered.filter((e) => e.seq <= firstHalfEnd.seq))
  const atRestart = replay(matchId, ordered.filter((e) => e.seq <= secondHalfStart.seq))
  const before = Object.values(atHalftime.onField)
  const after = Object.values(atRestart.onField)
  return {
    out: before.filter((playerId) => !after.includes(playerId)),
    in: after.filter((playerId) => !before.includes(playerId)),
  }
}
