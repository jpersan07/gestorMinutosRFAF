import { describe, expect, it } from 'vitest'
import {
  canEditMatchDetails,
  canEditReport,
  canEditSquad,
  isValidIsoDate,
  normalizeMatchDetails,
  seasonNameFor,
  validateMatchDetails,
  validatePlayerInput,
  type MatchStatus,
} from '..'

const ALL: MatchStatus[] = ['scheduled', 'setup', 'first_half', 'halftime', 'second_half', 'finished', 'saved']

describe('reglas de edición según el estado', () => {
  it('datos del partido y convocatoria: editables solo antes de PLAY', () => {
    expect(ALL.filter(canEditMatchDetails)).toEqual(['scheduled', 'setup'])
    expect(ALL.filter(canEditSquad)).toEqual(['scheduled', 'setup'])
  })

  it('informe: solo con el partido finalizado (no guardado)', () => {
    expect(ALL.filter(canEditReport)).toEqual(['finished'])
  })
})

describe('validación de jugador', () => {
  it('acepta nombre y dorsal válidos', () => {
    expect(validatePlayerInput({ name: 'Jorge', number: 14 }, [1, 2])).toEqual([])
    expect(validatePlayerInput({ name: 'Cero', number: 0 }, [])).toEqual([])
  })

  it('rechaza dorsales no enteros o fuera de rango', () => {
    for (const number of [-1, 100, 7.5, Number.NaN]) {
      expect(validatePlayerInput({ name: 'X', number }, [])).toEqual([{ field: 'number', code: 'INVALID' }])
    }
  })
})

describe('validación de partido', () => {
  it('normaliza vacíos a null y recorta espacios', () => {
    expect(normalizeMatchDetails({ opponent: ' A ', matchDate: '', kickoffTime: '  ', location: ' Campo ' })).toEqual({
      opponent: 'A',
      matchDate: null,
      kickoffTime: null,
      location: 'Campo',
    })
  })

  it('valida fechas reales y horas HH:MM', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('28/09/2026')).toBe(false)
    expect(validateMatchDetails({ opponent: 'A', matchDate: null, kickoffTime: '09:05', location: null })).toEqual([])
    expect(validateMatchDetails({ opponent: 'A', matchDate: null, kickoffTime: '9:05', location: null })).toEqual([
      { field: 'kickoffTime', code: 'INVALID' },
    ])
  })
})

describe('temporada', () => {
  it('va de julio a junio', () => {
    expect(seasonNameFor('2026-09-28')).toBe('2026-27')
    expect(seasonNameFor('2027-03-01')).toBe('2026-27')
    expect(seasonNameFor('2027-07-01')).toBe('2027-28')
    expect(seasonNameFor('2099-12-31')).toBe('2099-00')
  })
})
