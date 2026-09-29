import type { SyncIssue } from '../db'

/**
 * Qué hacer con un evento que append_match_events() ha rechazado:
 *   · needs-report → falta el informe en el servidor (RESULT_REQUIRED): subirlo y reintentar;
 *   · retry        → temporal (p. ej. faltan eventos anteriores): se reintenta después;
 *   · control-lost → otro dispositivo escribió antes / tiene el control: cuarentena + CONTROL PERDIDO;
 *   · invalid      → el servidor no acepta el contenido: cuarentena y aviso.
 * Nunca hay "gana el último" con los eventos.
 */
export type EventRejectionKind = 'needs-report' | 'retry' | 'control-lost' | 'invalid'

export function classifyEventRejection(reason: string): EventRejectionKind {
  switch (reason) {
    case 'RESULT_REQUIRED':
      return 'needs-report'
    case 'SEQ_GAP':
      return 'retry'
    case 'SEQ_CONFLICT':
    case 'NOT_CONTROLLER':
      return 'control-lost'
    default:
      return 'invalid'
  }
}

/** Resultado de subir una fila editable que el servidor no ha aceptado. */
export type RowFailure =
  /** Rechazo definitivo: queda en conflicto hasta que el entrenador lo cambie. */
  | { readonly kind: 'conflict'; readonly issue: SyncIssue }
  /** Temporal (red, partido aún no finalizado en el servidor, referencia aún no subida…). */
  | { readonly kind: 'retry' }

export function classifyRowError(error: { readonly code?: string; readonly message?: string }): RowFailure {
  const message = error.message ?? ''
  if (error.code === '23505' && message.includes('players_active_number_uq')) {
    return { kind: 'conflict', issue: 'NUMBER_TAKEN' }
  }
  if (/MATCH_DETAILS_LOCKED|SQUAD_LOCKED|MATCH_LOCKED/.test(message)) {
    return { kind: 'conflict', issue: 'MATCH_LOCKED' }
  }
  return { kind: 'retry' }
}
