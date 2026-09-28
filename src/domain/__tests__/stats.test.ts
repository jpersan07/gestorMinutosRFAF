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
    { id: 'b', name: 'Bruno' },
    { id: 'a', name: 'Álvaro' },
    { id: 'c', name: 'Carlos' },
    { id: 'z', name: 'Zoe' },
  ]

  it('ordena de más a menos minutos; a igualdad, alfabético (con acentos); sin datos, al final', () => {
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

  it('no modifica la lista original', () => {
    const original = [...players]
    sortPlayersByMinutes(players, new Map())
    expect(players).toEqual(original)
  })
})
