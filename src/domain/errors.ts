import type { EpochMs, Half, Id, MatchStatus, SlotId } from './types'

/**
 * Errores de dominio. Son códigos, no textos: la UI decide el mensaje en español.
 * Nunca se muestran errores técnicos al entrenador (PRD §33).
 */
export type DomainError =
  | { code: 'INVALID_TRANSITION'; status: MatchStatus; command: string }
  | { code: 'MATCH_LOCKED' }
  | { code: 'NOT_CONTROLLER'; controllerDeviceId: string | null }
  | { code: 'ALREADY_CONTROLLER' }
  | { code: 'UNKNOWN_FORMATION'; formationId: string }
  | { code: 'UNKNOWN_SLOT'; slotId: SlotId }
  | { code: 'LINEUP_INCOMPLETE'; missing: number }
  /** El jugador ya ocupa otra posición (`slotId`). */
  | { code: 'PLAYER_DUPLICATED'; playerId: Id; slotId: SlotId }
  | { code: 'PLAYER_NOT_IN_SQUAD'; playerId: Id }
  | { code: 'LINEUP_NOT_CONFIRMED'; half: Half }
  | { code: 'PLAYER_NOT_ON_FIELD'; playerId: Id }
  | { code: 'PLAYER_ALREADY_ON_FIELD'; playerId: Id }
  | { code: 'SAME_PLAYER' }
  | { code: 'HALF_OVER'; half: Half }
  | { code: 'HALFTIME_WAIT'; availableAt: EpochMs }
  | { code: 'NOTHING_TO_UNDO' }

export type DomainErrorCode = DomainError['code']

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })

export const fail = <T = never>(error: DomainError): Result<T> => ({ ok: false, error })
