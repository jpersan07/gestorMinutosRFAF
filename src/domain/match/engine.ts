import type { DomainError } from '../errors'
import type { Id } from '../types'
import { decide, type CommandContext, type MatchCommand } from './decide'
import type { EventContext } from './emit'
import { orderEvents, type MatchEvent } from './events'
import { evolve } from './evolve'
import { initialMatchState, type MatchState } from './state'
import { tick } from './tick'

export function applyEvents(state: MatchState, events: readonly MatchEvent[]): MatchState {
  return events.reduce(evolve, state)
}

/** Reconstruye el partido desde su historial (recarga, recuperación, otro dispositivo). */
export function replay(matchId: Id, events: readonly MatchEvent[]): MatchState {
  return applyEvents(initialMatchState(matchId), orderEvents(events))
}

export interface ExecuteResult {
  readonly state: MatchState
  /** Eventos nuevos a persistir: los automáticos vencidos y, si el comando es válido, los suyos. */
  readonly events: MatchEvent[]
  readonly error: DomainError | null
}

/**
 * Punto de entrada para los comandos del entrenador: primero `tick` (materializa lo que
 * el reloj ya ha decidido), después `decide`. Aunque el comando falle, los eventos
 * automáticos se devuelven para persistirlos.
 */
export function execute(state: MatchState, command: MatchCommand, ctx: CommandContext): ExecuteResult {
  const automatic = tick(state, ctx)
  const current = applyEvents(state, automatic)
  const decision = decide(current, command, ctx)
  if (!decision.ok) return { state: current, events: automatic, error: decision.error }
  return {
    state: applyEvents(current, decision.value),
    events: [...automatic, ...decision.value],
    error: null,
  }
}

/** Para el temporizador de la UI y al volver a primer plano: aplica solo los eventos automáticos. */
export function advance(state: MatchState, ctx: EventContext): { state: MatchState; events: MatchEvent[] } {
  const events = tick(state, ctx)
  return { state: applyEvents(state, events), events }
}
