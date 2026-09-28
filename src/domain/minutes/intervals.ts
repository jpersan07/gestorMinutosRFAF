import { orderEvents, type MatchEvent } from '../match/events'
import type { Half, Id, Lineup, MatchSecond } from '../types'

/** Tramo continuo en el campo, en segundos de partido: [from, to). */
export interface Interval {
  readonly from: MatchSecond
  readonly to: MatchSecond
}

export interface Timeline {
  /** Intervalos por jugador, ordenados y fusionados (0–45 + 45–90 → 0–90). */
  readonly intervals: ReadonlyMap<Id, readonly Interval[]>
  /** Titulares de la 1ª parte. */
  readonly starters: ReadonlySet<Id>
  /** Convocatoria congelada en MATCH_STARTED. */
  readonly squad: readonly Id[]
}

/**
 * Construye los tramos en el campo de cada jugador a partir de los eventos.
 *
 * - HALF_STARTED abre un tramo para los 11 de la alineación de esa parte.
 * - PLAYER_OUT cierra y PLAYER_IN abre (un jugador puede tener varios tramos: reentradas).
 * - HALF_ENDED cierra todos. Los cambios del descanso salen solos de comparar alineaciones.
 * - Los cambios anulados (SUBSTITUTION_UNDONE) se ignoran por completo: como si no hubieran ocurrido.
 *
 * `untilSecond` cierra los tramos abiertos de un partido en juego (minutos en directo).
 */
export function buildTimeline(events: readonly MatchEvent[], untilSecond?: MatchSecond): Timeline {
  const ordered = orderEvents(events)
  const undone = new Set(ordered.flatMap((e) => (e.type === 'SUBSTITUTION_UNDONE' ? [e.substitutionId] : [])))

  const lineups: Partial<Record<Half, Lineup>> = {}
  const open = new Map<Id, MatchSecond>()
  const intervals = new Map<Id, Interval[]>()
  const starters = new Set<Id>()
  let squad: readonly Id[] = []

  const enter = (playerId: Id, second: MatchSecond) => {
    if (!open.has(playerId)) open.set(playerId, second)
  }
  const leave = (playerId: Id, second: MatchSecond) => {
    const from = open.get(playerId)
    if (from === undefined) return
    open.delete(playerId)
    if (second > from) intervals.set(playerId, [...(intervals.get(playerId) ?? []), { from, to: second }])
  }

  for (const event of ordered) {
    switch (event.type) {
      case 'LINEUP_CONFIRMED':
        lineups[event.half] = event.lineup
        break
      case 'MATCH_STARTED':
        squad = event.squad
        break
      case 'HALF_STARTED':
        for (const playerId of Object.values(lineups[event.half]?.slots ?? {})) {
          enter(playerId, event.matchSecond)
          if (event.half === 1) starters.add(playerId)
        }
        break
      case 'PLAYER_OUT':
        if (!undone.has(event.substitutionId)) leave(event.playerId, event.matchSecond)
        break
      case 'PLAYER_IN':
        if (!undone.has(event.substitutionId)) enter(event.playerId, event.matchSecond)
        break
      case 'HALF_ENDED':
        for (const playerId of [...open.keys()]) leave(playerId, event.matchSecond)
        break
    }
  }

  if (untilSecond !== undefined) {
    for (const playerId of [...open.keys()]) leave(playerId, untilSecond)
  }

  const merged = new Map<Id, Interval[]>()
  for (const [playerId, list] of intervals) merged.set(playerId, mergeContiguous(list))
  return { intervals: merged, starters, squad }
}

function mergeContiguous(list: readonly Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.from - b.from)
  const result: Interval[] = []
  for (const interval of sorted) {
    const last = result.at(-1)
    if (last && interval.from <= last.to) {
      result[result.length - 1] = { from: last.from, to: Math.max(last.to, interval.to) }
    } else {
      result.push(interval)
    }
  }
  return result
}
