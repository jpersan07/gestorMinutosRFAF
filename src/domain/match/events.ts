import type { EpochMs, Half, Id, Lineup, MatchSecond, SlotId } from '../types'

/**
 * Metadatos comunes. Los eventos son inmutables y la fuente de verdad del partido:
 * el estado, los minutos y el resumen se reconstruyen a partir de ellos.
 */
export interface EventMeta {
  /** UUID generado en el cliente: reenviar el mismo evento no lo duplica. */
  readonly id: Id
  readonly matchId: Id
  /** Orden dentro del partido (1, 2, 3…). */
  readonly seq: number
  /** Momento real en que ocurrió (reloj del dispositivo controlador). */
  readonly occurredAt: EpochMs
  readonly deviceId: string
  readonly coachId: Id
}

interface SubstitutionFields {
  readonly half: Half
  readonly matchSecond: MatchSecond
  readonly substitutionId: Id
  readonly slotId: SlotId
  readonly playerId: Id
  /** En PLAYER_OUT: quien entra. En PLAYER_IN: quien sale. */
  readonly relatedPlayerId: Id
}

export type EventPayload =
  /** Empieza la preparación. El dispositivo que lo emite pasa a controlar el partido. */
  | { readonly type: 'SETUP_STARTED' }
  /** "TOMAR CONTROL": el dispositivo del evento pasa a ser el controlador. */
  | { readonly type: 'CONTROL_TAKEN' }
  /** Snapshot completo; si se confirma varias veces, vale la última. */
  | { readonly type: 'LINEUP_CONFIRMED'; readonly half: Half; readonly lineup: Lineup }
  /** Congela la duración de la parte y la convocatoria del partido. */
  | { readonly type: 'MATCH_STARTED'; readonly halfDurationS: number; readonly squad: readonly Id[] }
  | { readonly type: 'HALF_STARTED'; readonly half: Half; readonly matchSecond: MatchSecond }
  | ({ readonly type: 'PLAYER_OUT' } & SubstitutionFields)
  | ({ readonly type: 'PLAYER_IN' } & SubstitutionFields)
  /** Evento compensatorio: anula un cambio sin borrar sus eventos. */
  | {
      readonly type: 'SUBSTITUTION_UNDONE'
      readonly half: Half
      readonly matchSecond: MatchSecond
      readonly substitutionId: Id
    }
  | { readonly type: 'HALF_ENDED'; readonly half: Half; readonly matchSecond: MatchSecond }
  | { readonly type: 'MATCH_ENDED'; readonly matchSecond: MatchSecond }
  | { readonly type: 'MATCH_SAVED' }

export type MatchEvent = EventMeta & EventPayload

export type MatchEventType = EventPayload['type']

/**
 * Orden canónico: por `seq`, descartando ids repetidos (p. ej. un evento
 * que llega dos veces por un reintento de sincronización).
 */
export function orderEvents(events: readonly MatchEvent[]): MatchEvent[] {
  const seen = new Set<Id>()
  const unique: MatchEvent[] = []
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    unique.push(event)
  }
  return unique.sort((a, b) => a.seq - b.seq)
}
