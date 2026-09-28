import type { MatchStatus } from '../domain'

export const STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: 'Pendiente',
  setup: 'En preparación',
  first_half: 'En juego',
  halftime: 'Descanso',
  second_half: 'En juego',
  finished: 'Finalizado',
  saved: 'Guardado',
}

export function isLive(status: MatchStatus): boolean {
  return status === 'first_half' || status === 'halftime' || status === 'second_half'
}
