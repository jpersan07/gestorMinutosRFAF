import type { EventPayload, Half, Id, MatchEvent } from '../../domain'

// Conversión entre el evento del dominio (MatchEvent) y su representación en Supabase
// (fila de public.match_events / argumento de append_match_events). Función pura:
// el dominio no sabe nada de Supabase.

/** Evento tal como lo recibe `append_match_events` (occurred_at en milisegundos). */
export interface RemoteEventInput {
  readonly id: Id
  readonly seq: number
  readonly type: MatchEvent['type']
  readonly occurred_at: number
  readonly device_id: string
  readonly half: Half | null
  readonly match_second: number | null
  readonly player_id: Id | null
  readonly related_player_id: Id | null
  readonly substitution_id: Id | null
  readonly slot_id: string | null
  readonly payload: Record<string, unknown>
}

/** Fila de public.match_events tal como la devuelve la API (occurred_at en ISO). */
export interface RemoteEventRow {
  readonly id: Id
  readonly match_id: Id
  readonly seq: number
  readonly event_type: MatchEvent['type']
  readonly occurred_at: string
  readonly device_id: string
  readonly user_id: Id
  readonly half: number | null
  readonly match_second: number | null
  readonly player_id: Id | null
  readonly related_player_id: Id | null
  readonly substitution_id: Id | null
  readonly slot_id: string | null
  readonly payload: unknown
}

export function toRemoteEvent(event: MatchEvent): RemoteEventInput {
  const base: RemoteEventInput = {
    id: event.id,
    seq: event.seq,
    type: event.type,
    occurred_at: event.occurredAt,
    device_id: event.deviceId,
    half: null,
    match_second: null,
    player_id: null,
    related_player_id: null,
    substitution_id: null,
    slot_id: null,
    payload: {},
  }
  switch (event.type) {
    case 'SETUP_STARTED':
    case 'CONTROL_TAKEN':
    case 'MATCH_SAVED':
      return base
    case 'LINEUP_CONFIRMED':
      return { ...base, half: event.half, payload: { lineup: event.lineup } }
    case 'MATCH_STARTED':
      return { ...base, payload: { halfDurationS: event.halfDurationS, squad: event.squad } }
    case 'HALF_STARTED':
    case 'HALF_ENDED':
      return { ...base, half: event.half, match_second: event.matchSecond }
    case 'PLAYER_OUT':
    case 'PLAYER_IN':
      return {
        ...base,
        half: event.half,
        match_second: event.matchSecond,
        player_id: event.playerId,
        related_player_id: event.relatedPlayerId,
        substitution_id: event.substitutionId,
        slot_id: event.slotId,
      }
    case 'SUBSTITUTION_UNDONE':
      return { ...base, half: event.half, match_second: event.matchSecond, substitution_id: event.substitutionId }
    case 'MATCH_ENDED':
      return { ...base, match_second: event.matchSecond }
  }
}

class InvalidRemoteEvent extends Error {
  constructor(row: RemoteEventRow, field: string) {
    super(`Evento remoto ${row.id} (${row.event_type}) sin ${field}`)
    this.name = 'InvalidRemoteEvent'
  }
}

/**
 * Fila del servidor → evento del dominio. El autor (`coachId`) es el usuario de Auth
 * que lo registró: la identidad la decide el servidor, no el móvil.
 */
export function fromRemoteEvent(row: RemoteEventRow): MatchEvent {
  const need = <T,>(value: T | null, field: string): T => {
    if (value === null) throw new InvalidRemoteEvent(row, field)
    return value
  }
  const half = () => need(row.half, 'half') as Half
  const second = () => need(row.match_second, 'match_second')
  const payload = (row.payload ?? {}) as Record<string, unknown>

  let body: EventPayload
  switch (row.event_type) {
    case 'SETUP_STARTED':
    case 'CONTROL_TAKEN':
    case 'MATCH_SAVED':
      body = { type: row.event_type }
      break
    case 'LINEUP_CONFIRMED':
      body = { type: 'LINEUP_CONFIRMED', half: half(), lineup: payload.lineup as never }
      break
    case 'MATCH_STARTED':
      body = {
        type: 'MATCH_STARTED',
        halfDurationS: payload.halfDurationS as number,
        squad: payload.squad as Id[],
      }
      break
    case 'HALF_STARTED':
    case 'HALF_ENDED':
      body = { type: row.event_type, half: half(), matchSecond: second() }
      break
    case 'PLAYER_OUT':
    case 'PLAYER_IN':
      body = {
        type: row.event_type,
        half: half(),
        matchSecond: second(),
        playerId: need(row.player_id, 'player_id'),
        relatedPlayerId: need(row.related_player_id, 'related_player_id'),
        substitutionId: need(row.substitution_id, 'substitution_id'),
        slotId: need(row.slot_id, 'slot_id'),
      }
      break
    case 'SUBSTITUTION_UNDONE':
      body = {
        type: 'SUBSTITUTION_UNDONE',
        half: half(),
        matchSecond: second(),
        substitutionId: need(row.substitution_id, 'substitution_id'),
      }
      break
    case 'MATCH_ENDED':
      body = { type: 'MATCH_ENDED', matchSecond: second() }
      break
  }

  return {
    ...body,
    id: row.id,
    matchId: row.match_id,
    seq: row.seq,
    occurredAt: Date.parse(row.occurred_at),
    deviceId: row.device_id,
    coachId: row.user_id,
  }
}
