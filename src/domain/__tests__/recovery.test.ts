import { describe, expect, it } from 'vitest'
import {
  advance,
  buildMatchSummary,
  computeMinutes,
  formatClock,
  lineupOnField,
  matchSecondAt,
  replay,
  secondHalfAvailableAt,
  type MatchEvent,
} from '..'
import { LINEUP_433, MatchHarness, seededRandom } from './harness'

/** Simula guardar en IndexedDB y volver a leer tras recargar la página. */
function reload(events: readonly MatchEvent[]): MatchEvent[] {
  return JSON.parse(JSON.stringify(events)) as MatchEvent[]
}

describe('recuperación del partido', () => {
  it('reconstruir desde los eventos da exactamente el mismo estado en cada momento del partido', () => {
    const h = new MatchHarness()
    const checkpoint = () => expect(replay(h.matchId, reload(h.events))).toEqual(h.state)

    h.must({ type: 'START_SETUP' })
    checkpoint()
    h.must({ type: 'CONFIRM_LINEUP', lineup: LINEUP_433 })
    checkpoint()
    h.must({ type: 'START_MATCH' })
    checkpoint()
    h.sub('p10', 'p12', '20:00')
    checkpoint()
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    checkpoint()
    h.sub('p10', 'p13', '30:00')
    checkpoint()
    h.toHalftime()
    checkpoint()
    h.secondHalf()
    checkpoint()
    h.sub('p13', 'p10', '70:00')
    checkpoint()
    h.toFullTime()
    checkpoint()
    h.must({ type: 'SAVE_MATCH' })
    checkpoint()
  })

  it('recarga durante la primera parte: el cronómetro sigue donde debe', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.sub('p10', 'p12', '12:00')
    h.at('20:00')

    const events = reload(h.events)
    h.wait(10 * 60) // la página estuvo cerrada 10 minutos
    const recovered = replay(h.matchId, events)
    const { state, events: automatic } = advance(recovered, h.ctx())

    expect(automatic).toEqual([])
    expect(state.status).toBe('first_half')
    expect(formatClock(matchSecondAt(state, h.now))).toBe('30:00')
    expect(state.onField.ST).toBe('p12')
  })

  it('navegador cerrado durante el final de la 1ª parte: al volver está en el descanso con la hora exacta', () => {
    const h = new MatchHarness()
    h.kickOff()
    const kickOffAt = h.now
    h.at('40:00')
    const events = reload(h.events)

    h.wait(20 * 60) // vuelve en el "60:00" real
    const { state, events: automatic } = advance(replay(h.matchId, events), h.ctx())

    expect(automatic).toMatchObject([{ type: 'HALF_ENDED', occurredAt: kickOffAt + 2_700_000 }])
    expect(state.status).toBe('halftime')
    // Los 15 s ya pasaron: en cuanto confirme la alineación podrá continuar.
    expect(secondHalfAvailableAt(state)).toBeLessThan(h.now)
    expect(lineupOnField(state)).not.toBeNull()
  })

  it('teléfono bloqueado varios minutos en la 2ª parte hasta después del 90: partido finalizado y minutos correctos', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.secondHalf()
    h.sub('p10', 'p12', '57:42')
    h.at('85:00')
    const events = reload(h.events)

    h.wait(15 * 60)
    const { state, events: automatic } = advance(replay(h.matchId, events), h.ctx())
    expect(automatic.map((e) => e.type)).toEqual(['HALF_ENDED', 'MATCH_ENDED'])
    expect(state.status).toBe('finished')

    const minutes = computeMinutes([...events, ...automatic])
    expect(minutes.find((p) => p.playerId === 'p10')?.minutesPlayed).toBe(57)
    expect(minutes.find((p) => p.playerId === 'p12')?.minutesPlayed).toBe(33)
  })

  it('eventos duplicados (reintento de sincronización) no alteran nada', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.sub('p10', 'p12', '30:00')
    h.toHalftime()
    const duplicated = [...h.events, ...reload(h.events.slice(-3))]
    expect(replay(h.matchId, duplicated)).toEqual(h.state)
    expect(computeMinutes(duplicated, { untilSecond: 2700 })).toEqual(
      computeMinutes(h.events, { untilSecond: 2700 }),
    )
  })

  it('eventos recibidos desordenados se reordenan por seq', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.sub('p10', 'p12', '10:00')
    h.sub('p12', 'p10', '20:00')
    h.toHalftime()
    h.secondHalf()
    h.toFullTime()

    const random = seededRandom(42)
    const shuffled = [...h.events].sort(() => random() - 0.5)
    expect(replay(h.matchId, shuffled)).toEqual(h.state)
    expect(buildMatchSummary(h.matchId, shuffled, h.now)).toEqual(buildMatchSummary(h.matchId, h.events, h.now))
  })

  it('otro dispositivo que toma el control continúa el partido desde los eventos sincronizados', () => {
    const a = new MatchHarness()
    a.kickOff()
    a.sub('p10', 'p12', '15:00')

    // El móvil B recibe los eventos, reconstruye y toma el control.
    const b = new MatchHarness()
    b.deviceId = 'device-B'
    b.events = reload(a.events)
    b.state = replay(b.matchId, b.events)
    b.now = a.now + 60_000
    b.must({ type: 'TAKE_CONTROL' })
    b.sub('p09', 'p13', '25:00')

    expect(b.state.onField).toMatchObject({ ST: 'p12', LW: 'p13' })
    expect(b.events.map((e) => e.seq)).toEqual(b.events.map((_, i) => i + 1))
  })
})
