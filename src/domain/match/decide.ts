import { DEFAULT_HALF_DURATION_S } from '../constants'
import { fail, ok, type Result } from '../errors'
import { validateLineup } from '../lineup/lineup'
import type { Id, Lineup } from '../types'
import { halfEndsAt, matchSecondAt, secondHalfAvailableAt } from './clock'
import { createEmitter, type EventContext } from './emit'
import type { MatchEvent } from './events'
import { lastUndoableSubstitution, playingHalf, slotOfPlayerOnField, type MatchState } from './state'

export type MatchCommand =
  | { readonly type: 'START_SETUP' }
  | { readonly type: 'TAKE_CONTROL' }
  | { readonly type: 'CONFIRM_LINEUP'; readonly lineup: Lineup }
  | { readonly type: 'START_MATCH' }
  | { readonly type: 'SUBSTITUTE'; readonly outPlayerId: Id; readonly inPlayerId: Id }
  | { readonly type: 'UNDO_LAST_SUBSTITUTION' }
  | { readonly type: 'START_SECOND_HALF' }
  | { readonly type: 'SAVE_MATCH' }

export interface CommandContext extends EventContext {
  /** Convocatoria actual. Solo se usa antes de PLAY; después vale la congelada en MATCH_STARTED. */
  readonly squad: readonly Id[]
  /** Duración de la parte para START_MATCH. Por defecto 45 min. */
  readonly halfDurationS?: number
}

type Decision = Result<MatchEvent[]>

/**
 * Valida un comando contra el estado actual y devuelve los eventos que produce.
 * No modifica nada. Asume que el estado ya incluye los eventos automáticos
 * vencidos (ver `execute`), pero se protege igualmente del final de parte.
 */
export function decide(state: MatchState, command: MatchCommand, ctx: CommandContext): Decision {
  if (state.status === 'saved') return fail({ code: 'MATCH_LOCKED' })

  const emit = createEmitter(state, ctx)
  const invalid = (): Decision =>
    fail({ code: 'INVALID_TRANSITION', status: state.status, command: command.type })

  if (command.type === 'START_SETUP') {
    return state.status === 'scheduled' ? ok([emit({ type: 'SETUP_STARTED' })]) : invalid()
  }
  if (state.status === 'scheduled') return invalid()

  if (command.type === 'TAKE_CONTROL') {
    if (state.controllerDeviceId === ctx.deviceId) return fail({ code: 'ALREADY_CONTROLLER' })
    return ok([emit({ type: 'CONTROL_TAKEN' })])
  }

  if (state.controllerDeviceId !== ctx.deviceId) {
    return fail({ code: 'NOT_CONTROLLER', controllerDeviceId: state.controllerDeviceId })
  }

  switch (command.type) {
    case 'CONFIRM_LINEUP': {
      const half = state.status === 'setup' ? 1 : state.status === 'halftime' ? 2 : null
      if (half === null) return invalid()
      const squad = half === 1 ? ctx.squad : state.squad
      const valid = validateLineup(command.lineup, squad)
      if (!valid.ok) return fail(valid.error)
      return ok([emit({ type: 'LINEUP_CONFIRMED', half, lineup: valid.value })])
    }

    case 'START_MATCH': {
      if (state.status !== 'setup') return invalid()
      const lineup = state.lineups[1]
      if (!lineup) return fail({ code: 'LINEUP_NOT_CONFIRMED', half: 1 })
      // La convocatoria puede haber cambiado después de confirmar: se revalida.
      const squad = [...new Set(ctx.squad)]
      const valid = validateLineup(lineup, squad)
      if (!valid.ok) return fail(valid.error)
      return ok([
        emit({ type: 'MATCH_STARTED', halfDurationS: ctx.halfDurationS ?? DEFAULT_HALF_DURATION_S, squad }),
        emit({ type: 'HALF_STARTED', half: 1, matchSecond: 0 }),
      ])
    }

    case 'SUBSTITUTE': {
      const half = playingHalf(state)
      if (half === null) return invalid()
      if (isHalfOver(state, ctx)) return fail({ code: 'HALF_OVER', half })

      const { outPlayerId, inPlayerId } = command
      if (outPlayerId === inPlayerId) return fail({ code: 'SAME_PLAYER' })
      const slotId = slotOfPlayerOnField(state, outPlayerId)
      if (slotId === undefined) return fail({ code: 'PLAYER_NOT_ON_FIELD', playerId: outPlayerId })
      if (slotOfPlayerOnField(state, inPlayerId) !== undefined) {
        return fail({ code: 'PLAYER_ALREADY_ON_FIELD', playerId: inPlayerId })
      }
      // Reentrada permitida: basta con estar convocado y fuera del campo.
      if (!state.squad.includes(inPlayerId)) return fail({ code: 'PLAYER_NOT_IN_SQUAD', playerId: inPlayerId })

      const matchSecond = matchSecondAt(state, ctx.now)
      const substitutionId = ctx.newId()
      const common = { half, matchSecond, substitutionId, slotId }
      return ok([
        emit({ type: 'PLAYER_OUT', ...common, playerId: outPlayerId, relatedPlayerId: inPlayerId }),
        emit({ type: 'PLAYER_IN', ...common, playerId: inPlayerId, relatedPlayerId: outPlayerId }),
      ])
    }

    case 'UNDO_LAST_SUBSTITUTION': {
      const half = playingHalf(state)
      if (half === null) return invalid()
      if (isHalfOver(state, ctx)) return fail({ code: 'HALF_OVER', half })

      const sub = lastUndoableSubstitution(state)
      if (
        !sub ||
        state.onField[sub.slotId] !== sub.inPlayerId ||
        slotOfPlayerOnField(state, sub.outPlayerId) !== undefined
      ) {
        return fail({ code: 'NOTHING_TO_UNDO' })
      }
      return ok([
        emit({
          type: 'SUBSTITUTION_UNDONE',
          half,
          matchSecond: matchSecondAt(state, ctx.now),
          substitutionId: sub.id,
        }),
      ])
    }

    case 'START_SECOND_HALF': {
      if (state.status !== 'halftime') return invalid()
      if (!state.lineups[2]) return fail({ code: 'LINEUP_NOT_CONFIRMED', half: 2 })
      const availableAt = secondHalfAvailableAt(state)
      if (availableAt !== null && ctx.now < availableAt) return fail({ code: 'HALFTIME_WAIT', availableAt })
      return ok([emit({ type: 'HALF_STARTED', half: 2, matchSecond: state.halfDurationS })])
    }

    case 'SAVE_MATCH':
      return state.status === 'finished' ? ok([emit({ type: 'MATCH_SAVED' })]) : invalid()
  }
}

function isHalfOver(state: MatchState, ctx: CommandContext): boolean {
  const half = playingHalf(state)
  const endsAt = half === null ? null : halfEndsAt(state, half)
  return endsAt !== null && ctx.now >= endsAt
}
