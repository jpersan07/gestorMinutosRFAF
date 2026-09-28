import { describe, expect, it } from 'vitest'
import { tick } from '..'
import { LINEUP_433, MatchHarness } from './harness'

describe('final automático (tick)', () => {
  it('no hace nada antes de 45:00', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.at('44:59')
    expect(h.tick()).toEqual([])
    expect(h.state.status).toBe('first_half')
  })

  it('a las 45:00 cierra la primera parte con la hora exacta', () => {
    const h = new MatchHarness()
    h.kickOff()
    const kickOffAt = h.now
    h.at('45:00')
    const events = h.tick()
    expect(events).toMatchObject([
      { type: 'HALF_ENDED', half: 1, matchSecond: 2700, occurredAt: kickOffAt + 2_700_000 },
    ])
    expect(h.state.status).toBe('halftime')
  })

  it('con el teléfono bloqueado, al volver registra el final a la hora teórica, no a la de detección', () => {
    const h = new MatchHarness()
    h.kickOff()
    const kickOffAt = h.now
    h.wait(52 * 60) // vuelve en el "52:00"
    const [halfEnded] = h.tick()
    expect(halfEnded).toMatchObject({ type: 'HALF_ENDED', matchSecond: 2700, occurredAt: kickOffAt + 2_700_000 })
  })

  it('es idempotente: un segundo tick no duplica eventos', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.at('45:00')
    h.tick()
    h.wait(30)
    expect(h.tick()).toEqual([])
    expect(h.events.filter((e) => e.type === 'HALF_ENDED')).toHaveLength(1)
  })

  it('a las 90:00 finaliza el partido: HALF_ENDED + MATCH_ENDED', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.secondHalf()
    const secondHalfAt = h.now
    h.at('90:00')
    const events = h.tick()
    expect(events).toMatchObject([
      { type: 'HALF_ENDED', half: 2, matchSecond: 5400, occurredAt: secondHalfAt + 2_700_000 },
      { type: 'MATCH_ENDED', matchSecond: 5400, occurredAt: secondHalfAt + 2_700_000 },
    ])
    expect(h.state.status).toBe('finished')
  })

  it('bloqueo de 20 minutos que atraviesa el final del partido', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.secondHalf()
    const secondHalfAt = h.now
    h.at('80:00')
    h.wait(20 * 60)
    h.tick()
    expect(h.state.status).toBe('finished')
    expect(h.state.halfEndedAt[2]).toBe(secondHalfAt + 2_700_000)
  })

  it.each(['scheduled', 'setup', 'halftime', 'finished'] as const)('no genera nada en %s', (status) => {
    const h = new MatchHarness()
    if (status !== 'scheduled') h.must({ type: 'START_SETUP' })
    if (status === 'halftime' || status === 'finished') {
      h.must({ type: 'CONFIRM_LINEUP', lineup: LINEUP_433 })
      h.must({ type: 'START_MATCH' })
      h.toHalftime()
    }
    if (status === 'finished') {
      h.secondHalf()
      h.toFullTime()
    }
    expect(h.state.status).toBe(status)
    expect(tick(h.state, h.ctx({ now: h.now + 10 * 3600_000 }))).toEqual([])
  })

  it('un comando pulsado después del final primero materializa el final y luego se rechaza', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.at('45:00')
    h.wait(10)
    const result = h.run({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' })
    expect(result.error).toEqual({ code: 'INVALID_TRANSITION', status: 'halftime', command: 'SUBSTITUTE' })
    expect(result.events.map((e) => e.type)).toEqual(['HALF_ENDED'])
    expect(h.state.status).toBe('halftime')
    expect(h.state.onField.ST).toBe('p10')
  })
})
