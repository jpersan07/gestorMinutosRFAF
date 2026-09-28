import { HALFTIME_MIN_WAIT_MS } from '../constants'
import type { EpochMs, Half, MatchSecond } from '../types'
import type { MatchState } from './state'

// El cronómetro NUNCA cuenta: siempre se calcula a partir de timestamps persistidos.
// Si el móvil se bloquea o el navegador suspende JavaScript, al volver el valor es correcto.

/** Momento teórico en que termina una parte que ya ha empezado. */
export function halfEndsAt(state: MatchState, half: Half): EpochMs | null {
  const startedAt = state.halfStartedAt[half]
  return startedAt === undefined ? null : startedAt + state.halfDurationS * 1000
}

/** Segundo de partido en el instante `now`. La 2ª parte continúa desde el final de la 1ª. */
export function matchSecondAt(state: MatchState, now: EpochMs): MatchSecond {
  const duration = state.halfDurationS
  const elapsedIn = (half: Half): number => {
    const startedAt = state.halfStartedAt[half]
    if (startedAt === undefined) return 0
    const elapsed = Math.floor((now - startedAt) / 1000)
    return Math.min(duration, Math.max(0, elapsed))
  }

  switch (state.status) {
    case 'scheduled':
    case 'setup':
      return 0
    case 'first_half':
      return elapsedIn(1)
    case 'halftime':
      return duration
    case 'second_half':
      return duration + elapsedIn(2)
    case 'finished':
    case 'saved':
      return 2 * duration
  }
}

/**
 * Cuándo se puede pulsar CONTINUAR: 15 s después del final teórico de la 1ª parte.
 * (Además hace falta la alineación de la 2ª parte confirmada.)
 */
export function secondHalfAvailableAt(state: MatchState): EpochMs | null {
  const firstHalfEnd = state.halfEndedAt[1]
  return firstHalfEnd === undefined ? null : firstHalfEnd + HALFTIME_MIN_WAIT_MS
}

/** Minuto visible de un instante del partido: 57:42 → 57. */
export function clockMinute(second: MatchSecond): number {
  return Math.floor(second / 60)
}

/** "MM:SS" — 3462 → "57:42", 5400 → "90:00". */
export function formatClock(second: MatchSecond): string {
  const minutes = Math.floor(second / 60)
  const seconds = second % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
