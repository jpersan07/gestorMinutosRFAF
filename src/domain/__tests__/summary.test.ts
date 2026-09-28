import { describe, expect, it } from 'vitest'
import { buildMatchSummary } from '..'
import { LINEUP_433, lineupOf, MatchHarness } from './harness'

describe('resumen del partido', () => {
  function playedMatch() {
    const h = new MatchHarness()
    h.kickOff()
    h.sub('p10', 'p12', '32:10')
    h.sub('p09', 'p13', '40:00')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    h.toHalftime()
    // Descanso: pasa a 5-3-2, entra p14 y se queda fuera p11.
    h.secondHalf(
      lineupOf('5-3-2', ['p01', 'p02', 'p03', 'p04', 'p05', 'p14', 'p06', 'p07', 'p08', 'p09', 'p12']),
    )
    h.sub('p06', 'p15', '57:23')
    h.sub('p12', 'p10', '71:05')
    h.toFullTime()
    return h
  }

  it('lista los cambios en orden, con el minuto visible, sin los deshechos', () => {
    const h = playedMatch()
    const summary = buildMatchSummary(h.matchId, h.events, h.now)
    expect(summary.substitutions.map((s) => [s.minute, s.outPlayerId, s.inPlayerId])).toEqual([
      [32, 'p10', 'p12'],
      [57, 'p06', 'p15'],
      [71, 'p12', 'p10'],
    ])
  })

  it('muestra la formación de cada parte y la alineación inicial', () => {
    const h = playedMatch()
    const summary = buildMatchSummary(h.matchId, h.events, h.now)
    expect(summary.formations).toEqual({ 1: '4-3-3', 2: '5-3-2' })
    expect(summary.lineups[1]).toEqual(LINEUP_433)
    expect(summary.status).toBe('finished')
  })

  it('detecta los cambios hechos en el descanso', () => {
    const h = playedMatch()
    const summary = buildMatchSummary(h.matchId, h.events, h.now)
    expect(summary.halftimeChanges).toEqual({ out: ['p11'], in: ['p14'] })
  })

  it('sin cambios en el descanso, la lista está vacía', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.secondHalf()
    h.toFullTime()
    expect(buildMatchSummary(h.matchId, h.events, h.now).halftimeChanges).toEqual({ out: [], in: [] })
  })

  it('antes de la 2ª parte no hay cambios de descanso', () => {
    const h = new MatchHarness()
    h.kickOff()
    expect(buildMatchSummary(h.matchId, h.events, h.now).halftimeChanges).toBeNull()
  })

  it('calcula los minutos de todos los convocados y cada puesto suma 90', () => {
    const h = playedMatch()
    const summary = buildMatchSummary(h.matchId, h.events, h.now)
    const minutes = Object.fromEntries(summary.minutes.map((p) => [p.playerId, p.minutesPlayed]))
    expect(minutes).toEqual({
      p01: 90,
      p02: 90,
      p03: 90,
      p04: 90,
      p05: 90,
      p06: 57, // sale en 57:23
      p07: 90,
      p08: 90,
      p09: 90, // su cambio en el 40' se deshizo
      p10: 32 + (90 - 71), // sale en 32:10 y vuelve en 71:05
      p11: 45, // se queda fuera en el descanso
      p12: 71 - 32, // entra en 32:10, sale en 71:05
      p13: 0,
      p14: 45, // entra en el descanso
      p15: 90 - 57,
      p16: 0,
    })
    expect(summary.minutes.reduce((sum, p) => sum + p.minutesPlayed, 0)).toBe(990)
  })

  it('durante el partido muestra los minutos hasta el momento', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.at('10:30')
    const summary = buildMatchSummary(h.matchId, h.events, h.now)
    expect(summary.minutes.find((p) => p.playerId === 'p01')?.minutesPlayed).toBe(10)
  })
})
