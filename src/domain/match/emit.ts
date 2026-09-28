import type { EpochMs, Id } from '../types'
import type { EventPayload, MatchEvent } from './events'
import type { MatchState } from './state'

/** Lo que el dominio necesita del exterior para crear eventos. Se inyecta: nada de Date.now() aquí. */
export interface EventContext {
  readonly now: EpochMs
  readonly deviceId: string
  readonly coachId: Id
  readonly newId: () => Id
}

/** Crea eventos consecutivos a partir del último `seq` del estado. */
export function createEmitter(state: MatchState, ctx: EventContext) {
  let seq = state.lastSeq
  return (payload: EventPayload, occurredAt: EpochMs = ctx.now): MatchEvent => ({
    ...payload,
    id: ctx.newId(),
    matchId: state.matchId,
    seq: ++seq,
    occurredAt,
    deviceId: ctx.deviceId,
    coachId: ctx.coachId,
  })
}
