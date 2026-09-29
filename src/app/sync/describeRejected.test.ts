import { describe, expect, it } from 'vitest'
import { MatchHarness } from '../../domain/__tests__/harness'
import { describeRejectedEvents } from './describeRejected'

const nameOf = (id: string) => `Jugador ${Number(id.slice(1))}`

describe('cambios no aplicados, en lenguaje del partido', () => {
  it('un cambio (PLAYER_OUT + PLAYER_IN) es una sola línea con su minuto', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.secondHalf()
    const events = h.sub('p10', 'p12', '57:42')
    expect(describeRejectedEvents(events, nameOf)).toEqual(["57' Jugador 10 → Jugador 12"])
  })

  it('finales de parte, 2ª parte, deshacer y guardado', () => {
    const h = new MatchHarness()
    h.kickOff()
    const from = h.events.length
    h.sub('p10', 'p12', '20:00')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    h.toHalftime()
    h.secondHalf()
    h.toFullTime()
    h.must({ type: 'SAVE_MATCH' })
    expect(describeRejectedEvents(h.events.slice(from), nameOf)).toEqual([
      "20' Jugador 10 → Jugador 12",
      "20' Deshacer un cambio",
      "Final de la 1ª parte (45')",
      'Alineación de la 2ª parte',
      'Comienzo de la 2ª parte',
      "Final del partido (90')",
      'Partido guardado',
    ])
  })
})
