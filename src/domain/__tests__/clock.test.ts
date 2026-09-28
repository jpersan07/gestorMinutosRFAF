import { describe, expect, it } from 'vitest'
import { clockMinute, formatClock, matchSecondAt, secondHalfAvailableAt } from '..'
import { MatchHarness } from './harness'

describe('cronómetro basado en timestamps', () => {
  it('marca 00:00 antes de empezar', () => {
    const h = new MatchHarness()
    expect(matchSecondAt(h.state, h.now)).toBe(0)
    h.setup()
    h.wait(600)
    expect(matchSecondAt(h.state, h.now)).toBe(0)
  })

  it('se calcula desde el inicio de la parte, no contando ticks', () => {
    const h = new MatchHarness()
    h.kickOff()
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('00:00')
    h.wait(34 * 60 + 27)
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('34:27')
  })

  it('es correcto tras un bloqueo largo del teléfono (salto de 20 minutos)', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.wait(5 * 60)
    h.wait(20 * 60) // JS suspendido: ningún intervalo se ejecutó
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('25:00')
  })

  it('ignora fracciones de segundo', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.now += 59_999
    expect(matchSecondAt(h.state, h.now)).toBe(59)
  })

  it('nunca pasa de 45:00 en la primera parte, aunque aún no se haya procesado el final', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.wait(50 * 60)
    expect(h.state.status).toBe('first_half')
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('45:00')
  })

  it('nunca es negativo si el reloj del dispositivo retrocede', () => {
    const h = new MatchHarness()
    h.kickOff()
    expect(matchSecondAt(h.state, h.now - 5000)).toBe(0)
  })

  it('en el descanso marca 45:00 pase el tiempo que pase', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.wait(12 * 60)
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('45:00')
  })

  it('la segunda parte continúa desde 45:00 y termina en 90:00', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.wait(10 * 60)
    h.secondHalf()
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('45:00')
    h.wait(61)
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('46:01')
    h.wait(60 * 60)
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('90:00')
    h.tick()
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('90:00')
  })

  it('la segunda parte se habilita 15 s después del final teórico de la primera', () => {
    const h = new MatchHarness()
    h.kickOff()
    const kickOffAt = h.now
    h.toHalftime()
    expect(secondHalfAvailableAt(h.state)).toBe(kickOffAt + 45 * 60_000 + 15_000)
  })

  it('admite otra duración de parte (configurable internamente)', () => {
    const h = new MatchHarness()
    h.kickOff(undefined, { halfDurationS: 35 * 60 })
    h.wait(40 * 60)
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('35:00')
    h.tick()
    expect(h.state.status).toBe('halftime')
    h.secondHalf()
    h.wait(10 * 60)
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('45:00')
    h.wait(30 * 60)
    h.tick()
    expect(h.state.status).toBe('finished')
    expect(formatClock(matchSecondAt(h.state, h.now))).toBe('70:00')
  })

  it('formatea y redondea minutos', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(3462)).toBe('57:42')
    expect(formatClock(5400)).toBe('90:00')
    expect(clockMinute(3462)).toBe(57)
    expect(clockMinute(2699)).toBe(44)
  })
})
