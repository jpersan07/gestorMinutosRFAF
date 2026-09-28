import type { Formation, FormationId, FormationSlot } from './types'

// Coordenadas: x 0–100 (izquierda → derecha), y 0–100 (portería propia → rival).
// Los ids de slot son estables: las alineaciones guardadas los referencian.

const GK: FormationSlot = { id: 'GK', role: 'GK', label: 'POR', x: 50, y: 6 }

const BACK_FOUR: FormationSlot[] = [
  { id: 'LB', role: 'DEF', label: 'LI', x: 12, y: 26 },
  { id: 'LCB', role: 'DEF', label: 'DFC', x: 37, y: 22 },
  { id: 'RCB', role: 'DEF', label: 'DFC', x: 63, y: 22 },
  { id: 'RB', role: 'DEF', label: 'LD', x: 88, y: 26 },
]

export const FORMATIONS: Readonly<Record<FormationId, Formation>> = {
  '4-3-3': {
    id: '4-3-3',
    slots: [
      GK,
      ...BACK_FOUR,
      { id: 'LCM', role: 'MID', label: 'MC', x: 25, y: 50 },
      { id: 'CM', role: 'MID', label: 'MC', x: 50, y: 45 },
      { id: 'RCM', role: 'MID', label: 'MC', x: 75, y: 50 },
      { id: 'LW', role: 'ATT', label: 'EI', x: 18, y: 78 },
      { id: 'ST', role: 'ATT', label: 'DC', x: 50, y: 84 },
      { id: 'RW', role: 'ATT', label: 'ED', x: 82, y: 78 },
    ],
  },
  '5-3-2': {
    id: '5-3-2',
    slots: [
      GK,
      { id: 'LWB', role: 'DEF', label: 'CAI', x: 8, y: 32 },
      { id: 'LCB', role: 'DEF', label: 'DFC', x: 29, y: 22 },
      { id: 'CB', role: 'DEF', label: 'DFC', x: 50, y: 20 },
      { id: 'RCB', role: 'DEF', label: 'DFC', x: 71, y: 22 },
      { id: 'RWB', role: 'DEF', label: 'CAD', x: 92, y: 32 },
      { id: 'LCM', role: 'MID', label: 'MC', x: 25, y: 52 },
      { id: 'CM', role: 'MID', label: 'MC', x: 50, y: 48 },
      { id: 'RCM', role: 'MID', label: 'MC', x: 75, y: 52 },
      { id: 'LST', role: 'ATT', label: 'DC', x: 35, y: 82 },
      { id: 'RST', role: 'ATT', label: 'DC', x: 65, y: 82 },
    ],
  },
  '4-3-2-1': {
    id: '4-3-2-1',
    slots: [
      GK,
      ...BACK_FOUR,
      { id: 'LCM', role: 'MID', label: 'MC', x: 25, y: 46 },
      { id: 'CM', role: 'MID', label: 'MC', x: 50, y: 42 },
      { id: 'RCM', role: 'MID', label: 'MC', x: 75, y: 46 },
      { id: 'LAM', role: 'ATT', label: 'MP', x: 33, y: 68 },
      { id: 'RAM', role: 'ATT', label: 'MP', x: 67, y: 68 },
      { id: 'ST', role: 'ATT', label: 'DC', x: 50, y: 86 },
    ],
  },
}

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[]

export function isFormationId(value: string): value is FormationId {
  return Object.hasOwn(FORMATIONS, value)
}

export function getFormation(id: FormationId): Formation {
  return FORMATIONS[id]
}
