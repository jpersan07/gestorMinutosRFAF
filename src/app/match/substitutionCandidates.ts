import { computeMinutes, type Id, type MatchEvent, type MatchSecond, type PlayerTotals } from '../../domain'

/** Fila de la ventana CAMBIO: quién puede entrar y sus minutos. */
export interface SubstitutionCandidate<P> {
  readonly player: P
  /** Minutos en ESTE partido hasta el segundo actual (motor de minutos, intervalos incluidos). */
  readonly matchMinutes: number
  /**
   * Minutos de la TEMPORADA: partidos finalizados o guardados (seasonPlayerTotals). El partido en
   * juego no está incluido, así que nunca se cuenta dos veces.
   */
  readonly seasonMinutes: number
}

/**
 * Candidatos a entrar (convocados fuera del campo, incluidos los que ya jugaron y pueden volver),
 * por dorsal, con los minutos de este partido y los de la temporada.
 */
export function substitutionCandidates<P extends { readonly id: Id; readonly number: number }>(
  bench: readonly P[],
  events: readonly MatchEvent[],
  second: MatchSecond,
  seasonTotals: ReadonlyMap<Id, Pick<PlayerTotals, 'totalMinutes'>>,
): SubstitutionCandidate<P>[] {
  const matchMinutes = new Map(computeMinutes(events, { untilSecond: second }).map((p) => [p.playerId, p.minutesPlayed]))
  return [...bench]
    .sort((a, b) => a.number - b.number)
    .map((player) => ({
      player,
      matchMinutes: matchMinutes.get(player.id) ?? 0,
      seasonMinutes: seasonTotals.get(player.id)?.totalMinutes ?? 0,
    }))
}
