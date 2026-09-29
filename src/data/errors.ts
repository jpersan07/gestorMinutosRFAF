import type { DomainError, FieldError } from '../domain'

/** Errores que la capa de datos devuelve a la interfaz (nunca excepciones técnicas). */
export type DataError =
  | DomainError
  | { readonly code: 'VALIDATION'; readonly errors: readonly FieldError[] }
  | { readonly code: 'NOT_FOUND' }
  /** El partido ya empezó (o está guardado) y ese dato ya no se puede cambiar. */
  | { readonly code: 'LOCKED' }
  | { readonly code: 'RESULT_REQUIRED' }
  /** El servidor rechazó los eventos de este móvil: otro dispositivo tomó el control (3c). */
  | { readonly code: 'CONTROL_LOST' }
  /** TOMAR CONTROL solo existe en el servidor (3d): nunca se registra solo en el móvil. */
  | { readonly code: 'TAKE_CONTROL_REQUIRES_SERVER' }
  /** ENTENDIDO antes de haber descargado el estado oficial del partido (3d). */
  | { readonly code: 'OFFICIAL_STATE_PENDING' }

export type DataResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DataError }

export const okResult = <T>(value: T): DataResult<T> => ({ ok: true, value })
export const failResult = <T = never>(error: DataError): DataResult<T> => ({ ok: false, error })
