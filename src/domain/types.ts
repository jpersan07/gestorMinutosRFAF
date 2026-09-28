/** Identificador (UUID) generado en el cliente para poder crear datos sin conexión. */
export type Id = string

/** Milisegundos desde epoch, como `Date.now()`. */
export type EpochMs = number

/** Segundo de partido: 0 … 2 × duración de la parte (5400 en un partido de 2 × 45). */
export type MatchSecond = number

export type Half = 1 | 2

export type MatchStatus =
  | 'scheduled'
  | 'setup'
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'finished'
  | 'saved'

export type FormationId = '4-3-3' | '5-3-2' | '4-3-2-1'

export type SlotRole = 'GK' | 'DEF' | 'MID' | 'ATT'

/** Identificador estable de una posición dentro de una formación ('GK', 'LB', 'ST'…). */
export type SlotId = string

export interface FormationSlot {
  readonly id: SlotId
  readonly role: SlotRole
  /** Etiqueta corta visible en el campo (POR, DFC, MC…). */
  readonly label: string
  /** 0 = banda izquierda, 100 = banda derecha. */
  readonly x: number
  /** 0 = portería propia, 100 = portería rival. */
  readonly y: number
}

export interface Formation {
  readonly id: FormationId
  readonly slots: readonly FormationSlot[]
}

/**
 * Alineación: formación + qué jugador ocupa cada posición.
 * Mientras se edita puede estar incompleta; al confirmarse debe estar completa.
 */
export interface Lineup {
  readonly formationId: FormationId
  readonly slots: Readonly<Record<SlotId, Id>>
}

export interface Player {
  readonly id: Id
  readonly name: string
  readonly number: number | null
  readonly active: boolean
}
