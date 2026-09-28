import type { Id, SlotId } from '../types'
import type { MatchEvent } from './events'
import type { MatchState } from './state'

/**
 * Aplica un evento al estado. Es total: nunca falla, porque un evento es un hecho ya
 * ocurrido (la validación está en `decide`). Llamarla en orden reconstruye el partido.
 */
export function evolve(state: MatchState, event: MatchEvent): MatchState {
  return { ...applyEvent(state, event), lastSeq: Math.max(state.lastSeq, event.seq) }
}

function applyEvent(state: MatchState, event: MatchEvent): MatchState {
  switch (event.type) {
    case 'SETUP_STARTED':
      return { ...state, status: 'setup', controllerDeviceId: event.deviceId }

    case 'CONTROL_TAKEN':
      return { ...state, controllerDeviceId: event.deviceId }

    case 'LINEUP_CONFIRMED':
      return { ...state, lineups: { ...state.lineups, [event.half]: event.lineup } }

    case 'MATCH_STARTED':
      return { ...state, halfDurationS: event.halfDurationS, squad: [...event.squad] }

    case 'HALF_STARTED': {
      const lineup = state.lineups[event.half]
      return {
        ...state,
        status: event.half === 1 ? 'first_half' : 'second_half',
        halfStartedAt: { ...state.halfStartedAt, [event.half]: event.occurredAt },
        onField: lineup ? { ...lineup.slots } : {},
        currentFormationId: lineup?.formationId ?? state.currentFormationId,
      }
    }

    case 'PLAYER_OUT': {
      if (state.onField[event.slotId] !== event.playerId) return state
      const onField: Record<SlotId, Id> = { ...state.onField }
      delete onField[event.slotId]
      return { ...state, onField }
    }

    case 'PLAYER_IN':
      return {
        ...state,
        onField: { ...state.onField, [event.slotId]: event.playerId },
        substitutions: [
          ...state.substitutions,
          {
            id: event.substitutionId,
            half: event.half,
            matchSecond: event.matchSecond,
            slotId: event.slotId,
            outPlayerId: event.relatedPlayerId,
            inPlayerId: event.playerId,
            undone: false,
          },
        ],
      }

    case 'SUBSTITUTION_UNDONE': {
      const sub = state.substitutions.find((s) => s.id === event.substitutionId)
      if (!sub || sub.undone) return state
      return {
        ...state,
        onField: { ...state.onField, [sub.slotId]: sub.outPlayerId },
        substitutions: state.substitutions.map((s) => (s.id === sub.id ? { ...s, undone: true } : s)),
      }
    }

    case 'HALF_ENDED':
      return {
        ...state,
        status: event.half === 1 ? 'halftime' : state.status,
        halfEndedAt: { ...state.halfEndedAt, [event.half]: event.occurredAt },
      }

    case 'MATCH_ENDED':
      return { ...state, status: 'finished' }

    case 'MATCH_SAVED':
      return { ...state, status: 'saved' }
  }
}
