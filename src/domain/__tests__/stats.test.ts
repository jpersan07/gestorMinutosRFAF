import { describe, expect, it } from 'vitest'
import { aggregatePlayerTotals, computeMinutes, sortPlayersByMinutes, type MatchMinutesRecord } from '..'
import { MatchHarness } from './harness'

function finishedMatchRecord(matchId: string, play: (h: MatchHarness) => void): MatchMinutesRecord {
  const h = new MatchHarness(matchId)
  h.kickOff()
  play(h)
  h.toHalftime()
  h.secondHalf()
  h.toFullTime()
  return { matchId, squad: h.squad, players: computeMinutes(h.events) }
}

describe('estadísticas acumuladas', () => {
  it('suma minutos, partidos jugados, titularidades y convocatorias', () => {
    const records = [
      finishedMatchRecord('m1', (h) => h.sub('p10', 'p12', '30:00')),
      finishedMatchRecord('m2', (h) => h.sub('p10', 'p13', '20:00')),
    ]

    const totals = aggregatePlayerTotals(records)
    expect(totals.get('p10')).toEqual({
      playerId: 'p10',
      totalMinutes: 30 + 20,
      totalSeconds: 1800 + 1200,
      matchesPlayed: 2,
      starts: 2,
      callUps: 2,
    })
    expect(totals.get('p12')).toMatchObject({ totalMinutes: 60, matchesPlayed: 1, starts: 0, callUps: 2 })
    expect(totals.get('p16')).toMatchObject({ totalMinutes: 0, matchesPlayed: 0, starts: 0, callUps: 2 })
    expect(totals.get('p01')).toMatchObject({ totalMinutes: 180, matchesPlayed: 2, starts: 2 })
  })

  it('cuenta convocatorias aunque el jugador no tenga minutos registrados', () => {
    const totals = aggregatePlayerTotals([{ matchId: 'm1', squad: ['a', 'b'], players: [] }])
    expect(totals.get('b')).toMatchObject({ callUps: 1, totalMinutes: 0 })
  })
})

describe('orden de la convocatoria', () => {
  const players = [
    { id: 'b', name: 'Bruno', number: 8 },
    { id: 'a', name: 'Álvaro', number: 3 },
    { id: 'c', name: 'Carlos', number: 5 },
    { id: 'z', name: 'Zoe', number: 1 },
  ]

  it('ordena de más a menos minutos; a igualdad, por dorsal; sin datos, al final', () => {
    const totals = aggregatePlayerTotals([
      {
        matchId: 'm1',
        squad: ['a', 'b', 'c'],
        players: [
          { playerId: 'c', secondsPlayed: 5400, minutesPlayed: 90, started: true },
          { playerId: 'a', secondsPlayed: 1800, minutesPlayed: 30, started: false },
          { playerId: 'b', secondsPlayed: 1800, minutesPlayed: 30, started: true },
        ],
      },
    ])
    expect(sortPlayersByMinutes(players, totals).map((p) => p.name)).toEqual(['Carlos', 'Álvaro', 'Bruno', 'Zoe'])
  })

  it('a igualdad de minutos, el dorsal se compara como NÚMERO (2 antes que 10), nunca como texto', () => {
    const numbers = [16, 2, 12, 1, 15, 10, 14, 11, 13]
    const squad = numbers.map((number) => ({ id: `p${number}`, name: `Prueba${number}`, number }))
    const sorted = sortPlayersByMinutes(squad, new Map()).map((p) => p.number)
    expect(sorted).toEqual([1, 2, 10, 11, 12, 13, 14, 15, 16])
    expect(sorted).not.toEqual([1, 10, 11, 12, 13, 14, 15, 16, 2])
  })

  it('los minutos siguen mandando sobre el dorsal', () => {
    const totals = aggregatePlayerTotals([
      {
        matchId: 'm1',
        squad: ['A', 'B', 'C'],
        players: [
          { playerId: 'A', secondsPlayed: 1200, minutesPlayed: 20, started: true },
          { playerId: 'B', secondsPlayed: 600, minutesPlayed: 10, started: false },
          { playerId: 'C', secondsPlayed: 600, minutesPlayed: 10, started: false },
        ],
      },
    ])
    const squad = [
      { id: 'B', name: 'Jugador B', number: 2 },
      { id: 'C', name: 'Jugador C', number: 1 },
      { id: 'A', name: 'Jugador A', number: 10 },
    ]
    expect(sortPlayersByMinutes(squad, totals).map((p) => [p.id, p.number])).toEqual([
      ['A', 10],
      ['C', 1],
      ['B', 2],
    ])
  })

  it('sin dorsal, al final de su grupo de minutos; a igual dorsal, por nombre', () => {
    const squad = [
      { id: 'x', name: 'Sin dorsal', number: null },
      { id: 'o', name: 'Óscar', number: 5 },
      { id: 'n', name: 'Bruno', number: 5 },
      { id: 'u', name: 'Uno', number: 1 },
    ]
    expect(sortPlayersByMinutes(squad, new Map()).map((p) => p.name)).toEqual(['Uno', 'Bruno', 'Óscar', 'Sin dorsal'])
  })

  it('no modifica la lista original', () => {
    const original = [...players]
    sortPlayersByMinutes(players, new Map())
    expect(players).toEqual(original)
  })
})
