import { clockMinute } from '../match/clock'
import type { MatchEvent } from '../match/events'
import type { Id, MatchSecond } from '../types'
import { buildTimeline, type Interval } from './intervals'

export interface PlayerMinutes {
  readonly playerId: Id
  readonly intervals: readonly Interval[]
  /** Precisión completa. */
  readonly secondsPlayed: number
  /** Minutos para mostrar y para estadísticas (ver `displayMinutes`). */
  readonly minutesPlayed: number
  readonly started: boolean
}

/**
 * Política de redondeo (única, para poder cambiarla en un solo sitio):
 * diferencia de MINUTOS DE RELOJ de cada tramo.
 *
 *   sale en 57:42               → 57 − 0  = 57'
 *   entra en 57:42, acaba 90:00 → 90 − 57 = 33'
 *
 * Así lo que juegan los sucesivos ocupantes de un puesto suma siempre 90, como en el Excel.
 */
export function displayMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce((total, { from, to }) => total + clockMinute(to) - clockMinute(from), 0)
}

export interface ComputeMinutesOptions {
  /** Para un partido en juego: segundo actual (cierra los tramos abiertos). */
  readonly untilSecond?: MatchSecond
  /**
   * Jugadores a incluir aunque no hayan jugado (0'). Por defecto: la convocatoria
   * del partido más cualquiera que tenga minutos.
   */
  readonly playerIds?: readonly Id[]
}

export function computeMinutes(
  events: readonly MatchEvent[],
  options: ComputeMinutesOptions = {},
): PlayerMinutes[] {
  const timeline = buildTimeline(events, options.untilSecond)
  const playerIds = new Set([...(options.playerIds ?? timeline.squad), ...timeline.intervals.keys()])

  return [...playerIds].map((playerId) => {
    const intervals = timeline.intervals.get(playerId) ?? []
    return {
      playerId,
      intervals,
      secondsPlayed: intervals.reduce((total, { from, to }) => total + (to - from), 0),
      minutesPlayed: displayMinutes(intervals),
      started: timeline.starters.has(playerId),
    }
  })
}
