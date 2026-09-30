import { describe, expect, it } from 'vitest'
import { benchPlayers, matchSecondAt, replay } from '../../domain'
import { MatchHarness } from '../../domain/__tests__/harness'
import { substitutionCandidates } from './substitutionCandidates'

// Ventana CAMBIO: minutos de ESTE partido (motor de minutos, hasta el segundo actual) y minutos de
// la TEMPORADA (histórico de partidos finalizados; el partido en juego no está incluido).

const asPlayer = (id: string) => ({ id, number: Number(id.slice(1)) })

/**
 * 10' p09 → p15 · 20' p10 → p13 · 30' p15 → p09 (p09 vuelve) · descanso · 50' p09 → p16 ·
 * 60' p13 → p14. En el 63', fuera del campo: p09, p10, p12, p13 y p15.
 */
function match() {
  const h = new MatchHarness('m1')
  h.kickOff()
  h.sub('p09', 'p15', '10:00')
  h.sub('p10', 'p13', '20:00')
  h.sub('p15', 'p09', '30:00')
  h.toHalftime()
  h.secondHalf()
  h.sub('p09', 'p16', '50:00')
  h.sub('p13', 'p14', '60:00')
  return h
}

const season = new Map([
  ['p10', { totalMinutes: 180 }],
  ['p12', { totalMinutes: 321 }],
  ['p13', { totalMinutes: 250 }],
])

const rows = (h: MatchHarness, second: number) =>
  substitutionCandidates(benchPlayers(h.state).map(asPlayer), h.events, second, season).map((c) => [
    c.player.id,
    c.matchMinutes,
    c.seasonMinutes,
  ])

describe('ventana CAMBIO: minutos de este partido · de la temporada', () => {
  it('en el 63′: cada suplente con sus minutos de partido (intervalos incluidos) y de temporada, por dorsal', () => {
    const h = match()
    expect(rows(h, 63 * 60)).toEqual([
      ['p09', 30, 0], // 0–10 y 30–50: reentrada, suma los dos intervalos
      ['p10', 20, 180], // 0–20 y salió
      ['p12', 0, 321], // no ha jugado: partido 0, temporada 321
      ['p13', 40, 250], // entró en el 20, salió en el 60
      ['p15', 20, 0], // 10–30
    ])
  })

  it('los jugadores en el campo no son candidatos', () => {
    const h = match()
    const ids = rows(h, 63 * 60).map(([id]) => id)
    for (const onField of ['p01', 'p11', 'p14', 'p16']) expect(ids).not.toContain(onField)
  })

  it('el reloj avanza: lo del partido viene del motor en cada segundo; la temporada no cambia', () => {
    const h = new MatchHarness('m1')
    h.kickOff()
    h.sub('p10', 'p12', '20:00')
    // p10 salió en el 20: sus minutos de partido se quedan en 20 aunque avance el reloj.
    for (const second of [20 * 60, 21 * 60, 40 * 60]) expect(rows(h, second)[0]).toEqual(['p10', 20, 180])
    // Minutos de partido de quien entra, a medida que avanza (motor de minutos): 0 → 1 → 2.
    h.toHalftime()
    h.secondHalf()
    h.at('63:00')
    h.sub('p11', 'p13')
    const minutesOfP13 = (second: number) =>
      substitutionCandidates([asPlayer('p13')], h.events, second, season)[0]!.matchMinutes
    expect([minutesOfP13(63 * 60), minutesOfP13(64 * 60), minutesOfP13(65 * 60)]).toEqual([0, 1, 2])
    expect(substitutionCandidates([asPlayer('p13')], h.events, 65 * 60, season)[0]!.seasonMinutes).toBe(250)
  })

  it('replay de los eventos da exactamente lo mismo', () => {
    const h = match()
    const state = replay('m1', h.events)
    const second = matchSecondAt(state, h.now)
    expect(
      substitutionCandidates(benchPlayers(state).map(asPlayer), h.events, second, season),
    ).toEqual(substitutionCandidates(benchPlayers(h.state).map(asPlayer), h.events, second, season))
  })

  it('dorsal como número (9 antes que 10 y que 12)', () => {
    expect(rows(match(), 63 * 60).map(([id]) => id)).toEqual(['p09', 'p10', 'p12', 'p13', 'p15'])
  })
})
