import { clockMinute, type Id, type MatchEvent } from '../../domain'

/**
 * Cambios en cuarentena explicados en lenguaje del partido, para la pantalla
 * "OTRO DISPOSITIVO HA TOMADO EL CONTROL". Función pura.
 */
export function describeRejectedEvents(events: readonly MatchEvent[], nameOf: (id: Id) => string): string[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const lines: string[] = []
  const seenSubstitutions = new Set<Id>()
  let matchEndDescribed = false

  for (const event of ordered) {
    switch (event.type) {
      case 'PLAYER_OUT':
      case 'PLAYER_IN': {
        if (seenSubstitutions.has(event.substitutionId)) break
        seenSubstitutions.add(event.substitutionId)
        const [out, inn] = event.type === 'PLAYER_OUT'
          ? [event.playerId, event.relatedPlayerId]
          : [event.relatedPlayerId, event.playerId]
        lines.push(`${clockMinute(event.matchSecond)}' ${nameOf(out)} → ${nameOf(inn)}`)
        break
      }
      case 'SUBSTITUTION_UNDONE':
        lines.push(`${clockMinute(event.matchSecond)}' Deshacer un cambio`)
        break
      case 'HALF_ENDED':
        if (event.half === 1) lines.push(`Final de la 1ª parte (${clockMinute(event.matchSecond)}')`)
        else if (!matchEndDescribed) {
          matchEndDescribed = true
          lines.push(`Final del partido (${clockMinute(event.matchSecond)}')`)
        }
        break
      case 'MATCH_ENDED':
        if (!matchEndDescribed) {
          matchEndDescribed = true
          lines.push(`Final del partido (${clockMinute(event.matchSecond)}')`)
        }
        break
      case 'HALF_STARTED':
        lines.push(event.half === 1 ? 'Comienzo del partido' : 'Comienzo de la 2ª parte')
        break
      case 'LINEUP_CONFIRMED':
        lines.push(`Alineación de la ${event.half}ª parte`)
        break
      case 'SETUP_STARTED':
        lines.push('Preparación del partido')
        break
      case 'CONTROL_TAKEN':
        lines.push('Toma de control')
        break
      case 'MATCH_SAVED':
        lines.push('Partido guardado')
        break
      case 'MATCH_STARTED':
        // Va siempre con "Comienzo del partido" (HALF_STARTED de la 1ª parte).
        break
    }
  }
  return lines
}
