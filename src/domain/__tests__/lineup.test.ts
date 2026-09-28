import { describe, expect, it } from 'vitest'
import {
  assignPlayer,
  changeFormation,
  clearSlot,
  emptyLineup,
  missingSlots,
  sameLineup,
  validateLineup,
  type Lineup,
  type Result,
} from '..'
import { LINEUP_433, lineupOf, PLAYERS, SQUAD } from './harness'

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

describe('editor de alineación', () => {
  it('asigna un jugador a una posición', () => {
    const lineup = unwrap(assignPlayer(emptyLineup('4-3-3'), 'GK', 'p01'))
    expect(lineup.slots).toEqual({ GK: 'p01' })
  })

  it('reemplaza al ocupante anterior de la posición', () => {
    let lineup = unwrap(assignPlayer(emptyLineup('4-3-3'), 'GK', 'p01'))
    lineup = unwrap(assignPlayer(lineup, 'GK', 'p02'))
    expect(lineup.slots).toEqual({ GK: 'p02' })
  })

  it('no permite que un jugador ocupe dos posiciones e indica dónde está', () => {
    const lineup = unwrap(assignPlayer(emptyLineup('4-3-3'), 'ST', 'p10'))
    const result = assignPlayer(lineup, 'LW', 'p10')
    expect(result).toEqual({ ok: false, error: { code: 'PLAYER_DUPLICATED', playerId: 'p10', slotId: 'ST' } })
  })

  it('puede mover explícitamente a un jugador de posición', () => {
    const lineup = unwrap(assignPlayer(emptyLineup('4-3-3'), 'ST', 'p10'))
    const moved = unwrap(assignPlayer(lineup, 'LW', 'p10', { allowMove: true }))
    expect(moved.slots).toEqual({ LW: 'p10' })
  })

  it('reasignar al mismo jugador en su misma posición no cambia nada', () => {
    const lineup = unwrap(assignPlayer(emptyLineup('4-3-3'), 'ST', 'p10'))
    expect(unwrap(assignPlayer(lineup, 'ST', 'p10'))).toBe(lineup)
  })

  it('rechaza posiciones que no existen en la formación', () => {
    expect(assignPlayer(emptyLineup('4-3-3'), 'LWB', 'p01')).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_SLOT', slotId: 'LWB' },
    })
  })

  it('vacía una posición', () => {
    const lineup = clearSlot(LINEUP_433, 'GK')
    expect(lineup.slots.GK).toBeUndefined()
    expect(missingSlots(lineup)).toEqual(['GK'])
  })

  it('no muta la alineación original', () => {
    const original = unwrap(assignPlayer(emptyLineup('4-3-3'), 'GK', 'p01'))
    const snapshot = structuredClone(original)
    unwrap(assignPlayer(original, 'LB', 'p02'))
    clearSlot(original, 'GK')
    expect(original).toEqual(snapshot)
  })
})

describe('validación de alineación', () => {
  it('acepta una alineación completa de convocados', () => {
    expect(validateLineup(LINEUP_433, SQUAD)).toEqual({ ok: true, value: LINEUP_433 })
  })

  it('indica cuántas posiciones faltan', () => {
    const lineup = clearSlot(clearSlot(LINEUP_433, 'GK'), 'ST')
    expect(validateLineup(lineup, SQUAD)).toEqual({ ok: false, error: { code: 'LINEUP_INCOMPLETE', missing: 2 } })
  })

  it('una alineación vacía tiene 11 posiciones pendientes', () => {
    expect(validateLineup(emptyLineup('5-3-2'), SQUAD)).toEqual({
      ok: false,
      error: { code: 'LINEUP_INCOMPLETE', missing: 11 },
    })
  })

  it('detecta un jugador repetido aunque la alineación venga construida a mano', () => {
    const lineup: Lineup = { formationId: '4-3-3', slots: { ...LINEUP_433.slots, RW: 'p01' } }
    const result = validateLineup(lineup, SQUAD)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ code: 'PLAYER_DUPLICATED', playerId: 'p01' })
  })

  it('rechaza jugadores no convocados', () => {
    const lineup = lineupOf('4-3-3', [...PLAYERS.slice(0, 10), 'p17'])
    expect(validateLineup(lineup, SQUAD)).toEqual({
      ok: false,
      error: { code: 'PLAYER_NOT_IN_SQUAD', playerId: 'p17' },
    })
  })

  it('rechaza posiciones ajenas a la formación', () => {
    const lineup: Lineup = { formationId: '4-3-3', slots: { ...LINEUP_433.slots, LWB: 'p12' } }
    expect(validateLineup(lineup, SQUAD)).toEqual({ ok: false, error: { code: 'UNKNOWN_SLOT', slotId: 'LWB' } })
  })

  it('rechaza formaciones desconocidas', () => {
    const lineup = { formationId: '4-4-2', slots: {} } as unknown as Lineup
    expect(validateLineup(lineup, SQUAD)).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_FORMATION', formationId: '4-4-2' },
    })
  })
})

describe('cambio de formación', () => {
  it('recoloca por rol y deja sin asignar lo que no encaja (4-3-3 → 5-3-2)', () => {
    const lineup = changeFormation(LINEUP_433, '5-3-2')
    expect(lineup).toEqual({
      formationId: '5-3-2',
      slots: {
        GK: 'p01',
        LWB: 'p02',
        LCB: 'p03',
        CB: 'p04',
        RCB: 'p05',
        LCM: 'p06',
        CM: 'p07',
        RCM: 'p08',
        LST: 'p09',
        RST: 'p10',
      },
    })
    expect(missingSlots(lineup)).toEqual(['RWB'])
  })

  it('entre formaciones con los mismos roles no pierde a nadie (4-3-3 → 4-3-2-1)', () => {
    const lineup = changeFormation(LINEUP_433, '4-3-2-1')
    expect(missingSlots(lineup)).toEqual([])
    expect(new Set(Object.values(lineup.slots))).toEqual(new Set(Object.values(LINEUP_433.slots)))
  })

  it('a la misma formación no cambia nada', () => {
    expect(changeFormation(LINEUP_433, '4-3-3')).toBe(LINEUP_433)
  })
})

describe('comparar alineaciones', () => {
  it('compara formación y posiciones, no el orden de las claves', () => {
    const reordered: Lineup = { formationId: '4-3-3', slots: Object.fromEntries(Object.entries(LINEUP_433.slots).reverse()) }
    expect(sameLineup(LINEUP_433, reordered)).toBe(true)
    expect(sameLineup(LINEUP_433, clearSlot(LINEUP_433, 'GK'))).toBe(false)
    expect(sameLineup(LINEUP_433, changeFormation(LINEUP_433, '4-3-2-1'))).toBe(false)
    expect(sameLineup(null, undefined)).toBe(false)
    expect(sameLineup(null, null)).toBe(true)
  })
})
