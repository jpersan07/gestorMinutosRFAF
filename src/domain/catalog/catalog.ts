import type { MatchStatus } from '../types'

// Reglas de los datos del equipo (jugadores, partidos) independientes de dónde se guarden.

export type FieldErrorCode = 'REQUIRED' | 'INVALID' | 'TAKEN'

export interface FieldError {
  readonly field: string
  readonly code: FieldErrorCode
}

// ---------- Jugadores ----------

export interface PlayerInput {
  readonly name: string
  /** Dorsal. Obligatorio, entero 0–99. */
  readonly number: number | null
}

export const MIN_SHIRT_NUMBER = 0
export const MAX_SHIRT_NUMBER = 99

/**
 * `takenNumbers`: dorsales de los OTROS jugadores activos del equipo (no puede haber dos
 * jugadores activos con el mismo dorsal).
 */
export function validatePlayerInput(input: PlayerInput, takenNumbers: readonly number[]): FieldError[] {
  const errors: FieldError[] = []
  if (input.name.trim() === '') errors.push({ field: 'name', code: 'REQUIRED' })

  if (input.number === null) {
    errors.push({ field: 'number', code: 'REQUIRED' })
  } else if (
    !Number.isInteger(input.number) ||
    input.number < MIN_SHIRT_NUMBER ||
    input.number > MAX_SHIRT_NUMBER
  ) {
    errors.push({ field: 'number', code: 'INVALID' })
  } else if (takenNumbers.includes(input.number)) {
    errors.push({ field: 'number', code: 'TAKEN' })
  }
  return errors
}

// ---------- Partidos ----------

export interface MatchDetailsInput {
  /** Club / equipo rival. Único campo obligatorio. */
  readonly opponent: string
  /** 'YYYY-MM-DD' o vacío. */
  readonly matchDate: string | null
  /** 'HH:MM' o vacío. */
  readonly kickoffTime: string | null
  readonly location: string | null
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidIsoDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Recorta espacios y convierte los campos opcionales vacíos en null. */
export function normalizeMatchDetails(input: MatchDetailsInput): MatchDetailsInput {
  const optional = (value: string | null) => {
    const trimmed = value?.trim() ?? ''
    return trimmed === '' ? null : trimmed
  }
  return {
    opponent: input.opponent.trim(),
    matchDate: optional(input.matchDate),
    kickoffTime: optional(input.kickoffTime),
    location: optional(input.location),
  }
}

export function validateMatchDetails(input: MatchDetailsInput): FieldError[] {
  const details = normalizeMatchDetails(input)
  const errors: FieldError[] = []
  if (details.opponent === '') errors.push({ field: 'opponent', code: 'REQUIRED' })
  if (details.matchDate !== null && !isValidIsoDate(details.matchDate)) {
    errors.push({ field: 'matchDate', code: 'INVALID' })
  }
  if (details.kickoffTime !== null && !TIME_PATTERN.test(details.kickoffTime)) {
    errors.push({ field: 'kickoffTime', code: 'INVALID' })
  }
  return errors
}

/** Rival, escudo, fecha, hora y ubicación se pueden cambiar hasta pulsar PLAY. */
export function canEditMatchDetails(status: MatchStatus): boolean {
  return status === 'scheduled' || status === 'setup'
}

/** La convocatoria se puede cambiar hasta pulsar PLAY (después queda congelada en MATCH_STARTED). */
export function canEditSquad(status: MatchStatus): boolean {
  return canEditMatchDetails(status)
}

/** El informe se rellena con el partido finalizado y deja de ser editable al guardar. */
export function canEditReport(status: MatchStatus): boolean {
  return status === 'finished'
}

// ---------- Temporadas ----------

/** Temporada deportiva (julio–junio) de una fecha: '2026-09-28' → '2026-27'. */
export function seasonNameFor(isoDate: string): string {
  const [year = 0, month = 1] = isoDate.split('-').map(Number)
  const startYear = month >= 7 ? year : year - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}
