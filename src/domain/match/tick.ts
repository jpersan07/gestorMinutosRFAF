import { halfEndsAt } from './clock'
import { createEmitter, type EventContext } from './emit'
import type { MatchEvent } from './events'
import { playingHalf, type MatchState } from './state'

/**
 * Eventos automáticos que ya deberían haber ocurrido en `ctx.now`.
 *
 * Se registran con la hora TEÓRICA (inicio + duración), no con la hora en que se
 * detectan: si el móvil estuvo bloqueado y se vuelve en el "52:00", la parte acabó en 45:00.
 * Es idempotente: sobre un estado que ya los incluye, devuelve [].
 *
 * Solo el dispositivo controlador debe persistir estos eventos; los demás pueden usarlo
 * para mostrar el estado previsto.
 */
export function tick(state: MatchState, ctx: EventContext): MatchEvent[] {
  const half = playingHalf(state)
  if (half === null) return []
  const endsAt = halfEndsAt(state, half)
  if (endsAt === null || ctx.now < endsAt) return []

  const emit = createEmitter(state, ctx)
  const matchSecond = state.halfDurationS * half
  const halfEnded = emit({ type: 'HALF_ENDED', half, matchSecond }, endsAt)
  return half === 1 ? [halfEnded] : [halfEnded, emit({ type: 'MATCH_ENDED', matchSecond }, endsAt)]
}
