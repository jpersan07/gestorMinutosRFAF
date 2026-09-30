import type { EpochMs, Id, Player } from '../types'

/** Minutos de un jugador en un partido (proyección `player_match_minutes`). */
export interface PlayerMatchMinutes {
  readonly playerId: Id
  readonly secondsPlayed: number
  readonly minutesPlayed: number
  readonly started: boolean
}

export interface MatchMinutesRecord {
  readonly matchId: Id
  readonly squad: readonly Id[]
  readonly players: readonly PlayerMatchMinutes[]
}

export interface PlayerTotals {
  readonly playerId: Id
  /** Suma de los minutos mostrados de cada partido (igual que la columna Total del Excel). */
  readonly totalMinutes: number
  readonly totalSeconds: number
  readonly matchesPlayed: number
  readonly starts: number
  readonly callUps: number
}

/**
 * Acumula minutos por jugador. Qué partidos entran (temporada, competición, solo
 * finalizados…) lo decide quien llama; aquí solo se suma.
 */
export function aggregatePlayerTotals(records: readonly MatchMinutesRecord[]): Map<Id, PlayerTotals> {
  const totals = new Map<Id, PlayerTotals>()
  const get = (playerId: Id): PlayerTotals =>
    totals.get(playerId) ?? { playerId, totalMinutes: 0, totalSeconds: 0, matchesPlayed: 0, starts: 0, callUps: 0 }

  for (const record of records) {
    for (const playerId of new Set(record.squad)) {
      const current = get(playerId)
      totals.set(playerId, { ...current, callUps: current.callUps + 1 })
    }
    for (const player of record.players) {
      const current = get(player.playerId)
      totals.set(player.playerId, {
        ...current,
        totalMinutes: current.totalMinutes + player.minutesPlayed,
        totalSeconds: current.totalSeconds + player.secondsPlayed,
        matchesPlayed: current.matchesPlayed + (player.secondsPlayed > 0 ? 1 : 0),
        starts: current.starts + (player.started ? 1 : 0),
      })
    }
  }
  return totals
}

/** Convocatoria DEFINITIVA de un partido que cuenta para el histórico, y cuándo empezó. */
export interface SquadDecision {
  readonly squad: readonly Id[]
  /** Cuándo quedó decidida (PLAY: la convocatoria queda congelada). */
  readonly kickoffAt: EpochMs
}

/**
 * "SIN CONVOCAR": en cuántos de esos partidos NO estuvo convocado cada jugador. Solo cuentan los
 * partidos en los que el jugador ya pertenecía al equipo (dado de alta antes de PLAY). Qué partidos
 * entran (temporada, solo finalizados…) lo decide quien llama; aquí solo se cuenta.
 */
export function countNotCalledUp(
  decisions: readonly SquadDecision[],
  players: ReadonlyArray<{ readonly id: Id; readonly joinedAt: EpochMs }>,
): Map<Id, number> {
  const counts = new Map(players.map((p) => [p.id, 0]))
  for (const decision of decisions) {
    const called = new Set(decision.squad)
    for (const player of players) {
      if (player.joinedAt <= decision.kickoffAt && !called.has(player.id)) {
        counts.set(player.id, (counts.get(player.id) ?? 0) + 1)
      }
    }
  }
  return counts
}

/**
 * Orden de la convocatoria: más minutos primero; a igualdad, por DORSAL de menor a mayor comparado
 * como número (2 antes que 10; sin dorsal, al final) y, si también coincide, por nombre.
 */
export function sortPlayersByMinutes<P extends Pick<Player, 'id' | 'name' | 'number'>>(
  players: readonly P[],
  totals: ReadonlyMap<Id, PlayerTotals>,
): P[] {
  const minutesOf = (player: P) => totals.get(player.id)?.totalMinutes ?? 0
  const byNumber = (a: P, b: P) => {
    if (a.number === b.number) return 0
    if (a.number === null) return 1
    if (b.number === null) return -1
    return a.number - b.number
  }
  return [...players].sort(
    (a, b) =>
      minutesOf(b) - minutesOf(a) ||
      byNumber(a, b) ||
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }),
  )
}
