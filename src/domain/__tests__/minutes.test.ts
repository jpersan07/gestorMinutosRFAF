import { describe, expect, it } from 'vitest'
import {
  benchPlayers,
  computeMinutes,
  displayMinutes,
  FORMATION_IDS,
  getFormation,
  matchSecondAt,
  PLAYERS_ON_FIELD,
} from '..'
import { lineupOf, MatchHarness, seededRandom, SQUAD } from './harness'

function playFullMatch(firstHalf: (h: MatchHarness) => void = () => {}, secondHalf = firstHalf) {
  const h = new MatchHarness()
  h.kickOff()
  firstHalf(h)
  h.toHalftime()
  h.secondHalf()
  secondHalf(h)
  h.toFullTime()
  return h
}

describe('política de redondeo', () => {
  it('usa la diferencia de minutos de reloj', () => {
    expect(displayMinutes([{ from: 0, to: 3462 }])).toBe(57) // sale en 57:42
    expect(displayMinutes([{ from: 3462, to: 5400 }])).toBe(33) // entra en 57:42 (juega 32:18)
    expect(displayMinutes([{ from: 0, to: 5400 }])).toBe(90)
    expect(displayMinutes([])).toBe(0)
  })
})

describe('cálculo de minutos (casos límite del PRD)', () => {
  it('jugador que juega todo el partido → 90\'', () => {
    const h = playFullMatch()
    const [gk] = computeMinutes(h.events)
    expect(gk).toMatchObject({
      playerId: 'p01',
      secondsPlayed: 5400,
      minutesPlayed: 90,
      started: true,
      intervals: [{ from: 0, to: 5400 }],
    })
  })

  it('titular sale en 57:42 → 57\' y quien entra → 33\', conservando los segundos', () => {
    const h = playFullMatch(() => {}, (h) => h.sub('p10', 'p12', '57:42'))
    expect(h.minutes()).toMatchObject({ p10: 57, p12: 33 })
    expect(h.seconds()).toMatchObject({ p10: 3462, p12: 1938 })
  })

  it('titular que sale en 45:00 (cambio en el descanso) → 45\'; quien entra exactamente en 45:00 → 45\'', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.toHalftime()
    h.secondHalf(lineupOf('4-3-3', ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p12', 'p11']))
    h.toFullTime()
    expect(h.minutes()).toMatchObject({ p10: 45, p12: 45 })
    expect(h.seconds()).toMatchObject({ p10: 2700, p12: 2700 })
  })

  it('jugador que entra después del 45 (60:30) → 30\'', () => {
    const h = playFullMatch(() => {}, (h) => h.sub('p10', 'p12', '60:30'))
    expect(h.minutes()).toMatchObject({ p10: 60, p12: 30 })
  })

  it('jugador en el campo hasta el 90:00 cuenta hasta el final', () => {
    const h = playFullMatch(() => {}, (h) => h.sub('p10', 'p12', '89:59'))
    expect(h.minutes()).toMatchObject({ p10: 89, p12: 1 })
    expect(h.seconds()).toMatchObject({ p10: 5399, p12: 1 })
  })

  it('jugador convocado que no juega → 0\' (aparece en la lista)', () => {
    const h = playFullMatch()
    const p16 = computeMinutes(h.events).find((p) => p.playerId === 'p16')
    expect(p16).toEqual({ playerId: 'p16', intervals: [], secondsPlayed: 0, minutesPlayed: 0, started: false })
  })

  it('los no convocados no aparecen', () => {
    const h = playFullMatch()
    expect(computeMinutes(h.events).map((p) => p.playerId)).toEqual(SQUAD)
  })

  it('se pueden incluir jugadores extra con 0\'', () => {
    const h = playFullMatch()
    const ids = computeMinutes(h.events, { playerIds: ['p17'] }).map((p) => p.playerId)
    expect(ids).toContain('p17')
  })

  it('jugador que entra y sale → la diferencia', () => {
    const h = playFullMatch(
      (h) => h.sub('p10', 'p12', '20:15'),
      (h) => h.sub('p12', 'p13', '70:40'),
    )
    expect(h.minutes()).toMatchObject({ p10: 20, p12: 50, p13: 20 })
    expect(h.seconds()).toMatchObject({ p10: 1215, p12: 4240 - 1215, p13: 5400 - 4240 })
  })

  it('cambio en la 1ª parte que sigue en la 2ª: un solo tramo continuo', () => {
    const h = playFullMatch((h) => h.sub('p10', 'p12', '30:00'), () => {})
    const p12 = computeMinutes(h.events).find((p) => p.playerId === 'p12')
    expect(p12).toMatchObject({ intervals: [{ from: 1800, to: 5400 }], minutesPlayed: 60, started: false })
  })

  it('reentrada: suma todos los tramos del jugador (A 0–30 + 70–90 = 50\', B 30–70 = 40\')', () => {
    const h = playFullMatch(
      (h) => h.sub('p10', 'p12', '30:00'),
      (h) => h.sub('p12', 'p10', '70:00'),
    )
    const a = computeMinutes(h.events).find((p) => p.playerId === 'p10')
    expect(a).toMatchObject({
      intervals: [
        { from: 0, to: 1800 },
        { from: 4200, to: 5400 },
      ],
      minutesPlayed: 50,
    })
    expect(h.minutes()).toMatchObject({ p10: 50, p12: 40 })
  })

  it('reentrada con segundos: cada tramo aplica la misma política', () => {
    const h = playFullMatch(
      (h) => {
        h.sub('p10', 'p12', '10:30')
        h.sub('p12', 'p10', '20:45')
      },
      () => {},
    )
    // p10: 0–10:30 (10') + 20:45–90:00 (70') = 80'; p12: 10:30–20:45 (10')
    expect(h.minutes()).toMatchObject({ p10: 80, p12: 10 })
    expect(h.seconds()).toMatchObject({ p10: 630 + (5400 - 1245), p12: 1245 - 630 })
  })

  it('un cambio deshecho no cuenta: como si no hubiera ocurrido', () => {
    const h = playFullMatch((h) => {
      h.sub('p10', 'p12', '30:00')
      h.wait(20)
      h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    }, () => {})
    expect(h.minutes()).toMatchObject({ p10: 90, p12: 0 })
  })

  it('deshacer y rehacer más tarde cuenta desde el nuevo momento', () => {
    const h = playFullMatch(
      () => {},
      (h) => {
        h.sub('p10', 'p12', '60:00')
        h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
        h.sub('p10', 'p13', '75:00')
      },
    )
    expect(h.minutes()).toMatchObject({ p10: 75, p12: 0, p13: 15 })
  })

  it('minutos en directo durante el partido (untilSecond)', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.sub('p10', 'p12', '20:00')
    h.at('33:30')
    const live = computeMinutes(h.events, { untilSecond: matchSecondAt(h.state, h.now) })
    expect(live.find((p) => p.playerId === 'p10')?.minutesPlayed).toBe(20)
    expect(live.find((p) => p.playerId === 'p12')?.minutesPlayed).toBe(13)
    expect(live.find((p) => p.playerId === 'p01')?.minutesPlayed).toBe(33)
  })

  it('los titulares se marcan como tales, también si salen', () => {
    const h = playFullMatch((h) => h.sub('p10', 'p12', '10:00'), () => {})
    const byId = Object.fromEntries(computeMinutes(h.events).map((p) => [p.playerId, p.started]))
    expect(byId).toMatchObject({ p10: true, p12: false, p16: false })
  })
})

describe('invariante: cada puesto suma 90\' (200 partidos aleatorios)', () => {
  function randomMatch(seed: number) {
    const random = seededRandom(seed)
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
    const h = new MatchHarness(`match-${seed}`)
    h.kickOff()

    const playHalf = (from: number, to: number) => {
      const count = Math.floor(random() * 8)
      const times = Array.from({ length: count }, () => from + 1 + Math.floor(random() * (to - from - 1))).sort(
        (a, b) => a - b,
      )
      for (const second of times) {
        const onField = Object.values(h.state.onField)
        h.sub(pick(onField), pick(benchPlayers(h.state)), second)
        if (random() < 0.25) h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
      }
    }

    playHalf(0, 2700)
    h.toHalftime()
    // 2ª parte: formación y once aleatorios entre los convocados.
    const formationId = pick(FORMATION_IDS)
    const shuffled = [...h.squad].sort(() => random() - 0.5)
    h.wait(Math.floor(random() * 900))
    h.secondHalf(lineupOf(formationId, shuffled.slice(0, getFormation(formationId).slots.length)))
    playHalf(2700, 5400)
    h.toFullTime()
    return h
  }

  it.each(Array.from({ length: 200 }, (_, i) => i + 1))('partido aleatorio #%i', (seed) => {
    const h = randomMatch(seed)
    const minutes = computeMinutes(h.events)

    const totalMinutes = minutes.reduce((sum, p) => sum + p.minutesPlayed, 0)
    const totalSeconds = minutes.reduce((sum, p) => sum + p.secondsPlayed, 0)
    expect(totalMinutes).toBe(PLAYERS_ON_FIELD * 90)
    expect(totalSeconds).toBe(PLAYERS_ON_FIELD * 5400)

    for (const player of minutes) {
      expect(player.minutesPlayed).toBeGreaterThanOrEqual(0)
      expect(player.minutesPlayed).toBeLessThanOrEqual(90)
      // Tramos ordenados y sin solapes: nadie está dos veces en el campo a la vez.
      player.intervals.forEach((interval, i) => {
        expect(interval.to).toBeGreaterThan(interval.from)
        const next = player.intervals[i + 1]
        if (next) expect(next.from).toBeGreaterThan(interval.to)
      })
    }
  })
})
