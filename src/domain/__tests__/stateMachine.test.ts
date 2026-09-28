import { describe, expect, it } from 'vitest'
import {
  changeFormation,
  decide,
  DEFAULT_HALF_DURATION_S,
  lineupOnField,
  replay,
  type MatchCommand,
  type MatchStatus,
} from '..'
import { LINEUP_433, lineupOf, MatchHarness, PLAYERS } from './harness'

const COMMANDS: Record<MatchCommand['type'], MatchCommand> = {
  START_SETUP: { type: 'START_SETUP' },
  TAKE_CONTROL: { type: 'TAKE_CONTROL' },
  CONFIRM_LINEUP: { type: 'CONFIRM_LINEUP', lineup: LINEUP_433 },
  START_MATCH: { type: 'START_MATCH' },
  SUBSTITUTE: { type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' },
  UNDO_LAST_SUBSTITUTION: { type: 'UNDO_LAST_SUBSTITUTION' },
  START_SECOND_HALF: { type: 'START_SECOND_HALF' },
  SAVE_MATCH: { type: 'SAVE_MATCH' },
}

/** Deja un partido en el estado pedido, siguiendo el flujo real. */
function harnessIn(status: MatchStatus): MatchHarness {
  const h = new MatchHarness()
  if (status === 'scheduled') return h
  h.must({ type: 'START_SETUP' })
  if (status === 'setup') return h
  h.must({ type: 'CONFIRM_LINEUP', lineup: LINEUP_433 })
  h.must({ type: 'START_MATCH' })
  if (status === 'first_half') return h
  h.toHalftime()
  if (status === 'halftime') return h
  h.secondHalf()
  if (status === 'second_half') return h
  h.toFullTime()
  if (status === 'finished') return h
  h.must({ type: 'SAVE_MATCH' })
  return h
}

/** Comandos que NO tienen sentido en cada estado (→ INVALID_TRANSITION). */
const INVALID: Record<Exclude<MatchStatus, 'saved'>, MatchCommand['type'][]> = {
  scheduled: [
    'TAKE_CONTROL',
    'CONFIRM_LINEUP',
    'START_MATCH',
    'SUBSTITUTE',
    'UNDO_LAST_SUBSTITUTION',
    'START_SECOND_HALF',
    'SAVE_MATCH',
  ],
  setup: ['START_SETUP', 'SUBSTITUTE', 'UNDO_LAST_SUBSTITUTION', 'START_SECOND_HALF', 'SAVE_MATCH'],
  first_half: ['START_SETUP', 'CONFIRM_LINEUP', 'START_MATCH', 'START_SECOND_HALF', 'SAVE_MATCH'],
  halftime: ['START_SETUP', 'START_MATCH', 'SUBSTITUTE', 'UNDO_LAST_SUBSTITUTION', 'SAVE_MATCH'],
  second_half: ['START_SETUP', 'CONFIRM_LINEUP', 'START_MATCH', 'START_SECOND_HALF', 'SAVE_MATCH'],
  finished: [
    'START_SETUP',
    'CONFIRM_LINEUP',
    'START_MATCH',
    'SUBSTITUTE',
    'UNDO_LAST_SUBSTITUTION',
    'START_SECOND_HALF',
  ],
}

describe('máquina de estados', () => {
  it('recorre el flujo completo sin saltos', () => {
    const h = new MatchHarness()
    const statuses: MatchStatus[] = [h.state.status]
    const record = () => statuses.push(h.state.status)

    h.must({ type: 'START_SETUP' })
    record()
    h.must({ type: 'CONFIRM_LINEUP', lineup: LINEUP_433 })
    h.must({ type: 'START_MATCH' })
    record()
    h.toHalftime()
    record()
    h.secondHalf()
    record()
    h.toFullTime()
    record()
    h.must({ type: 'SAVE_MATCH' })
    record()

    expect(statuses).toEqual(['scheduled', 'setup', 'first_half', 'halftime', 'second_half', 'finished', 'saved'])
  })

  describe.each(Object.entries(INVALID) as [Exclude<MatchStatus, 'saved'>, MatchCommand['type'][]][])(
    'en %s',
    (status, invalidCommands) => {
      it.each(invalidCommands)('rechaza %s como transición inválida sin generar eventos', (commandType) => {
        const h = harnessIn(status)
        const before = h.state
        const result = decide(h.state, COMMANDS[commandType], h.ctx())
        expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TRANSITION', status } })
        expect(h.state).toBe(before)
      })
    },
  )

  it.each(Object.keys(COMMANDS) as MatchCommand['type'][])(
    'un partido guardado es de solo lectura (%s → MATCH_LOCKED)',
    (commandType) => {
      const h = harnessIn('saved')
      const result = decide(h.state, COMMANDS[commandType], h.ctx({ deviceId: 'otro' }))
      expect(result).toEqual({ ok: false, error: { code: 'MATCH_LOCKED' } })
    },
  )

  it('no hay eventos automáticos después de finalizar: guardar es siempre manual', () => {
    const h = harnessIn('finished')
    h.wait(24 * 3600)
    expect(h.tick()).toEqual([])
    expect(h.state.status).toBe('finished')
  })
})

describe('preparación y primera parte', () => {
  it('no permite iniciar sin alineación confirmada', () => {
    const h = harnessIn('setup')
    h.expectError({ type: 'START_MATCH' }, 'LINEUP_NOT_CONFIRMED')
    expect(h.state.status).toBe('setup')
  })

  it('no permite confirmar una alineación incompleta', () => {
    const h = harnessIn('setup')
    const lineup = lineupOf('4-3-3', PLAYERS.slice(0, 9))
    const result = h.expectError({ type: 'CONFIRM_LINEUP', lineup }, 'LINEUP_INCOMPLETE')
    expect(result.error).toEqual({ code: 'LINEUP_INCOMPLETE', missing: 2 })
  })

  it('antes de PLAY la alineación se puede reconfirmar libremente: vale la última', () => {
    const h = harnessIn('setup')
    h.must({ type: 'CONFIRM_LINEUP', lineup: LINEUP_433 })
    const second = lineupOf('5-3-2', ['p01', 'p02', 'p03', 'p04', 'p05', 'p12', 'p06', 'p07', 'p08', 'p09', 'p10'])
    h.must({ type: 'CONFIRM_LINEUP', lineup: second })
    h.must({ type: 'START_MATCH' })
    expect(lineupOnField(h.state)).toEqual(second)
  })

  it('PLAY genera MATCH_STARTED + HALF_STARTED con la duración y la convocatoria congeladas', () => {
    const h = harnessIn('setup')
    h.must({ type: 'CONFIRM_LINEUP', lineup: LINEUP_433 })
    const events = h.must({ type: 'START_MATCH' })
    expect(events.map((e) => e.type)).toEqual(['MATCH_STARTED', 'HALF_STARTED'])
    expect(events[0]).toMatchObject({ halfDurationS: DEFAULT_HALF_DURATION_S, squad: h.squad })
    expect(events[1]).toMatchObject({ half: 1, matchSecond: 0, occurredAt: h.now })
    expect(h.state.onField).toEqual(LINEUP_433.slots)
  })

  it('revalida la alineación si la convocatoria cambió después de confirmar', () => {
    const h = harnessIn('setup')
    h.must({ type: 'CONFIRM_LINEUP', lineup: LINEUP_433 })
    h.squad = h.squad.filter((id) => id !== 'p05')
    h.expectError({ type: 'START_MATCH' }, 'PLAYER_NOT_IN_SQUAD')
  })

  it('después de PLAY la convocatoria ya no cambia', () => {
    const h = harnessIn('first_half')
    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p17' }, 'PLAYER_NOT_IN_SQUAD', {
      squad: [...h.squad, 'p17'],
    })
  })
})

describe('descanso y segunda parte', () => {
  it('al llegar a 45:00 se pasa al descanso y se bloquean los cambios', () => {
    const h = harnessIn('first_half')
    h.toHalftime()
    expect(h.state.status).toBe('halftime')
    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' }, 'INVALID_TRANSITION')
  })

  it('no permite continuar sin la alineación de la segunda parte', () => {
    const h = harnessIn('halftime')
    h.wait(60)
    const result = h.expectError({ type: 'START_SECOND_HALF' }, 'LINEUP_NOT_CONFIRMED')
    expect(result.error).toEqual({ code: 'LINEUP_NOT_CONFIRMED', half: 2 })
  })

  it('confirmada antes de 15 s: espera hasta que pasen los 15 s', () => {
    const h = harnessIn('halftime')
    const halfEnd = h.now
    h.wait(5)
    h.must({ type: 'CONFIRM_LINEUP', lineup: lineupOnField(h.state)! })
    const result = h.expectError({ type: 'START_SECOND_HALF' }, 'HALFTIME_WAIT')
    expect(result.error).toEqual({ code: 'HALFTIME_WAIT', availableAt: halfEnd + 15_000 })

    h.now = halfEnd + 14_999
    h.expectError({ type: 'START_SECOND_HALF' }, 'HALFTIME_WAIT')

    h.now = halfEnd + 15_000
    const events = h.must({ type: 'START_SECOND_HALF' })
    expect(events).toMatchObject([{ type: 'HALF_STARTED', half: 2, matchSecond: 2700, occurredAt: h.now }])
    expect(h.state.status).toBe('second_half')
  })

  it('confirmada después de 15 s: empieza cuando el entrenador pulsa continuar', () => {
    const h = harnessIn('halftime')
    h.wait(4 * 60)
    h.must({ type: 'CONFIRM_LINEUP', lineup: lineupOnField(h.state)! })
    h.wait(30)
    const pressedAt = h.now
    h.must({ type: 'START_SECOND_HALF' })
    expect(h.state.halfStartedAt[2]).toBe(pressedAt)
  })

  it('la segunda parte puede cambiar formación, jugadores y posiciones', () => {
    const h = harnessIn('first_half')
    h.sub('p10', 'p12', '30:00')
    h.toHalftime()
    // p10 (sustituido en la 1ª parte) vuelve de titular; nueva formación 5-3-2 con p13 y p14.
    const lineup = lineupOf('5-3-2', ['p01', 'p13', 'p02', 'p03', 'p04', 'p14', 'p06', 'p07', 'p08', 'p10', 'p12'])
    h.secondHalf(lineup)
    expect(h.state.currentFormationId).toBe('5-3-2')
    expect(lineupOnField(h.state)).toEqual(lineup)
  })

  it('la alineación de la segunda parte se puede reconfirmar hasta pulsar continuar', () => {
    const h = harnessIn('halftime')
    const onField = lineupOnField(h.state)!
    h.must({ type: 'CONFIRM_LINEUP', lineup: onField })
    const changed = changeFormation(onField, '4-3-2-1')
    h.must({ type: 'CONFIRM_LINEUP', lineup: changed })
    h.wait(15)
    h.must({ type: 'START_SECOND_HALF' })
    expect(h.state.currentFormationId).toBe('4-3-2-1')
  })

  it('la alineación de la segunda parte solo admite convocados', () => {
    const h = harnessIn('halftime')
    const lineup = lineupOf('4-3-3', [...PLAYERS.slice(0, 10), 'p18'])
    h.expectError({ type: 'CONFIRM_LINEUP', lineup }, 'PLAYER_NOT_IN_SQUAD')
  })
})

describe('control del partido (un solo móvil)', () => {
  it('quien inicia la preparación controla el partido', () => {
    const h = harnessIn('setup')
    expect(h.state.controllerDeviceId).toBe('device-A')
  })

  it('otro dispositivo puede consultar pero no modificar', () => {
    const h = harnessIn('first_half')
    const result = h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' }, 'NOT_CONTROLLER', {
      deviceId: 'device-B',
    })
    expect(result.error).toEqual({ code: 'NOT_CONTROLLER', controllerDeviceId: 'device-A' })
    // Pero puede reconstruir el estado a partir de los eventos sincronizados.
    expect(replay(h.matchId, h.events)).toEqual(h.state)
  })

  it('TOMAR CONTROL cambia el dispositivo controlador', () => {
    const h = harnessIn('first_half')
    h.must({ type: 'TAKE_CONTROL' }, { deviceId: 'device-B', coachId: 'coach-jordi' })
    expect(h.state.controllerDeviceId).toBe('device-B')

    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' }, 'NOT_CONTROLLER')
    h.wait(60)
    h.must({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' }, { deviceId: 'device-B' })
    expect(h.state.onField.ST).toBe('p12')
  })

  it('el controlador actual no necesita tomar el control', () => {
    const h = harnessIn('setup')
    h.expectError({ type: 'TAKE_CONTROL' }, 'ALREADY_CONTROLLER')
  })

  it.each(['setup', 'first_half', 'halftime', 'second_half', 'finished'] as const)(
    'se puede tomar el control en %s',
    (status) => {
      const h = harnessIn(status)
      h.must({ type: 'TAKE_CONTROL' }, { deviceId: 'device-B' })
      expect(h.state.controllerDeviceId).toBe('device-B')
      expect(h.state.status).toBe(status)
    },
  )

  it('cualquier dispositivo puede iniciar la preparación de un partido pendiente', () => {
    const h = new MatchHarness()
    h.must({ type: 'START_SETUP' }, { deviceId: 'device-C' })
    expect(h.state.controllerDeviceId).toBe('device-C')
  })
})

describe('eventos', () => {
  it('tienen seq consecutivo, ids únicos y el partido correcto', () => {
    const h = harnessIn('first_half')
    h.sub('p10', 'p12', '20:00')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    h.toHalftime()
    h.secondHalf()
    h.sub('p09', 'p13', '60:00')
    h.toFullTime()
    h.must({ type: 'SAVE_MATCH' })

    expect(h.events.map((e) => e.seq)).toEqual(h.events.map((_, i) => i + 1))
    expect(new Set(h.events.map((e) => e.id)).size).toBe(h.events.length)
    expect(h.events.every((e) => e.matchId === h.matchId)).toBe(true)
    expect(h.state.lastSeq).toBe(h.events.length)
  })
})
