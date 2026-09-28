import { describe, expect, it } from 'vitest'
import { benchPlayers, decide, lastUndoableSubstitution } from '..'
import { MatchHarness } from './harness'

function inFirstHalf() {
  const h = new MatchHarness()
  h.kickOff()
  return h
}

describe('cambios', () => {
  it('registra PLAYER_OUT + PLAYER_IN con el segundo exacto, la posición y el mismo id de cambio', () => {
    const h = inFirstHalf()
    const events = h.sub('p10', 'p12', '32:10')
    expect(events).toHaveLength(2)
    const [out, inn] = events
    expect(out).toMatchObject({
      type: 'PLAYER_OUT',
      half: 1,
      matchSecond: 1930,
      slotId: 'ST',
      playerId: 'p10',
      relatedPlayerId: 'p12',
      occurredAt: h.now,
    })
    expect(inn).toMatchObject({
      type: 'PLAYER_IN',
      half: 1,
      matchSecond: 1930,
      slotId: 'ST',
      playerId: 'p12',
      relatedPlayerId: 'p10',
    })
    expect(new Set(events.map((e) => ('substitutionId' in e ? e.substitutionId : null))).size).toBe(1)
    expect(h.state.onField.ST).toBe('p12')
  })

  it('el que entra ocupa la posición del que sale', () => {
    const h = inFirstHalf()
    h.sub('p02', 'p13', '10:00')
    expect(h.state.onField.LB).toBe('p13')
    expect(Object.values(h.state.onField)).toHaveLength(11)
  })

  it('no puede salir quien no está en el campo', () => {
    const h = inFirstHalf()
    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p12', inPlayerId: 'p13' }, 'PLAYER_NOT_ON_FIELD')
  })

  it('no puede entrar quien ya está en el campo', () => {
    const h = inFirstHalf()
    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p09' }, 'PLAYER_ALREADY_ON_FIELD')
  })

  it('no se puede cambiar a un jugador por sí mismo', () => {
    const h = inFirstHalf()
    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p10' }, 'SAME_PLAYER')
  })

  it('solo pueden entrar convocados', () => {
    const h = inFirstHalf()
    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p17' }, 'PLAYER_NOT_IN_SQUAD')
  })

  it('un error no genera eventos ni cambia el campo', () => {
    const h = inFirstHalf()
    const before = h.state
    const result = h.run({ type: 'SUBSTITUTE', outPlayerId: 'p12', inPlayerId: 'p13' })
    expect(result.events).toEqual([])
    expect(h.state).toBe(before)
  })

  it('los suplentes disponibles son los convocados fuera del campo, incluidos los ya sustituidos', () => {
    const h = inFirstHalf()
    expect(benchPlayers(h.state)).toEqual(['p12', 'p13', 'p14', 'p15', 'p16'])
    h.sub('p10', 'p12', '20:00')
    expect(benchPlayers(h.state)).toEqual(['p10', 'p13', 'p14', 'p15', 'p16'])
  })

  it('un cambio en 44:59 es válido', () => {
    const h = inFirstHalf()
    const [out] = h.sub('p10', 'p12', '44:59')
    expect(out).toMatchObject({ matchSecond: 2699 })
  })

  it('un cambio en 45:00 ya no es válido: la parte ha terminado', () => {
    const h = inFirstHalf()
    h.at('45:00')
    // decide por sí solo también se protege aunque nadie haya procesado el final.
    expect(decide(h.state, { type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' }, h.ctx())).toEqual({
      ok: false,
      error: { code: 'HALF_OVER', half: 1 },
    })
  })

  it('no se permiten cambios después de 90:00', () => {
    const h = inFirstHalf()
    h.toHalftime()
    h.secondHalf()
    h.at('90:00')
    expect(decide(h.state, { type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' }, h.ctx())).toEqual({
      ok: false,
      error: { code: 'HALF_OVER', half: 2 },
    })
    h.tick()
    h.expectError({ type: 'SUBSTITUTE', outPlayerId: 'p10', inPlayerId: 'p12' }, 'INVALID_TRANSITION')
  })
})

describe('reentradas', () => {
  it('A sale en 30\', B entra; A vuelve en 70\', B sale — todo queda registrado', () => {
    const h = inFirstHalf()
    const kickOffAt = h.now
    h.sub('p10', 'p12', '30:00')
    h.toHalftime()
    h.secondHalf()
    const secondHalfAt = h.now
    h.sub('p12', 'p10', '70:00')

    const subs = h.events.filter((e) => e.type === 'PLAYER_OUT' || e.type === 'PLAYER_IN')
    expect(subs.map((e) => [e.type, e.playerId, e.matchSecond, e.occurredAt])).toEqual([
      ['PLAYER_OUT', 'p10', 1800, kickOffAt + 1_800_000],
      ['PLAYER_IN', 'p12', 1800, kickOffAt + 1_800_000],
      ['PLAYER_OUT', 'p12', 4200, secondHalfAt + 1_500_000],
      ['PLAYER_IN', 'p10', 4200, secondHalfAt + 1_500_000],
    ])
    expect(h.state.onField.ST).toBe('p10')
  })

  it('un jugador puede entrar y salir varias veces en la misma parte', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '10:00')
    h.sub('p12', 'p10', '20:00')
    h.sub('p10', 'p12', '30:00')
    h.sub('p12', 'p10', '40:00')
    expect(h.state.onField.ST).toBe('p10')
    expect(h.state.substitutions).toHaveLength(4)
  })

  it('un jugador que salió puede entrar en otra posición', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '10:00')
    h.sub('p02', 'p10', '20:00')
    expect(h.state.onField.LB).toBe('p10')
    expect(h.state.onField.ST).toBe('p12')
  })
})

describe('deshacer el último cambio', () => {
  it('restaura el campo con un evento compensatorio, sin tocar los eventos anteriores', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '30:00')
    const snapshot = structuredClone(h.events)
    h.wait(40)
    const events = h.must({ type: 'UNDO_LAST_SUBSTITUTION' })

    expect(events).toMatchObject([{ type: 'SUBSTITUTION_UNDONE', half: 1, matchSecond: 1840 }])
    expect(h.events.slice(0, snapshot.length)).toEqual(snapshot)
    expect(h.state.onField.ST).toBe('p10')
    expect(h.state.substitutions).toMatchObject([{ outPlayerId: 'p10', inPlayerId: 'p12', undone: true }])
  })

  it('deshace en orden inverso y avisa cuando no queda nada', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '10:00')
    h.sub('p09', 'p13', '20:00')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    expect(h.state.onField.LW).toBe('p09')
    expect(h.state.onField.ST).toBe('p12')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    expect(h.state.onField.ST).toBe('p10')
    h.expectError({ type: 'UNDO_LAST_SUBSTITUTION' }, 'NOTHING_TO_UNDO')
  })

  it('sin cambios no hay nada que deshacer', () => {
    const h = inFirstHalf()
    h.expectError({ type: 'UNDO_LAST_SUBSTITUTION' }, 'NOTHING_TO_UNDO')
  })

  it('funciona con reentradas', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '10:00')
    h.sub('p02', 'p10', '20:00')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    expect(h.state.onField.LB).toBe('p02')
    expect(h.state.onField.ST).toBe('p12')
  })

  it('no alcanza cambios de la parte anterior', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '30:00')
    h.toHalftime()
    h.secondHalf()
    expect(lastUndoableSubstitution(h.state)).toBeUndefined()
    h.expectError({ type: 'UNDO_LAST_SUBSTITUTION' }, 'NOTHING_TO_UNDO')
  })

  it('no se puede deshacer en el descanso', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '30:00')
    h.toHalftime()
    h.expectError({ type: 'UNDO_LAST_SUBSTITUTION' }, 'INVALID_TRANSITION')
  })

  it('no se puede deshacer una vez terminada la parte', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '30:00')
    h.at('45:00')
    expect(decide(h.state, { type: 'UNDO_LAST_SUBSTITUTION' }, h.ctx())).toEqual({
      ok: false,
      error: { code: 'HALF_OVER', half: 1 },
    })
  })

  it('tras deshacer, el mismo cambio se puede rehacer más tarde con otro id', () => {
    const h = inFirstHalf()
    h.sub('p10', 'p12', '30:00')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    h.sub('p10', 'p12', '35:00')
    const [first, second] = h.state.substitutions
    expect(first).toMatchObject({ matchSecond: 1800, undone: true })
    expect(second).toMatchObject({ matchSecond: 2100, undone: false })
    expect(second?.id).not.toBe(first?.id)

    h.toHalftime()
    h.secondHalf()
    h.toFullTime()
    expect(h.minutes()).toMatchObject({ p10: 35, p12: 55 })
  })
})
