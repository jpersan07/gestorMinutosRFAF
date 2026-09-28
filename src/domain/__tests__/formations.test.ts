import { describe, expect, it } from 'vitest'
import { FORMATION_IDS, FORMATIONS, getFormation, isFormationId, PLAYERS_ON_FIELD, type SlotRole } from '..'

const EXPECTED_ROLES: Record<string, Record<SlotRole, number>> = {
  '4-3-3': { GK: 1, DEF: 4, MID: 3, ATT: 3 },
  '5-3-2': { GK: 1, DEF: 5, MID: 3, ATT: 2 },
  '4-3-2-1': { GK: 1, DEF: 4, MID: 3, ATT: 3 },
}

describe('formaciones', () => {
  it('existen las tres formaciones iniciales', () => {
    expect(FORMATION_IDS).toEqual(['4-3-3', '5-3-2', '4-3-2-1'])
  })

  it.each(FORMATION_IDS)('%s tiene 11 posiciones con ids únicos y coordenadas válidas', (id) => {
    const formation = getFormation(id)
    expect(formation.slots).toHaveLength(PLAYERS_ON_FIELD)
    expect(new Set(formation.slots.map((s) => s.id)).size).toBe(PLAYERS_ON_FIELD)
    for (const slot of formation.slots) {
      expect(slot.x).toBeGreaterThanOrEqual(0)
      expect(slot.x).toBeLessThanOrEqual(100)
      expect(slot.y).toBeGreaterThanOrEqual(0)
      expect(slot.y).toBeLessThanOrEqual(100)
      expect(slot.label.length).toBeGreaterThan(0)
    }
  })

  it.each(FORMATION_IDS)('%s reparte los roles según su dibujo', (id) => {
    const counts: Record<SlotRole, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 }
    for (const slot of FORMATIONS[id].slots) counts[slot.role]++
    expect(counts).toEqual(EXPECTED_ROLES[id])
  })

  it.each(FORMATION_IDS)('%s tiene al portero junto a la portería propia (abajo)', (id) => {
    const gk = FORMATIONS[id].slots.find((s) => s.role === 'GK')
    const others = FORMATIONS[id].slots.filter((s) => s.role !== 'GK')
    expect(gk).toBeDefined()
    for (const slot of others) expect(slot.y).toBeGreaterThan(gk!.y)
  })

  it('reconoce ids válidos e inválidos', () => {
    expect(isFormationId('4-3-3')).toBe(true)
    expect(isFormationId('4-4-2')).toBe(false)
    expect(isFormationId('toString')).toBe(false)
  })
})
