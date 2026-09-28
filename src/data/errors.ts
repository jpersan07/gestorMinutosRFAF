import type { DomainError, FieldError } from '../domain'

/** Errores que la capa de datos devuelve a la interfaz (nunca excepciones técnicas). */
export type DataError =
  | DomainError
  | { readonly code: 'VALIDATION'; readonly errors: readonly FieldError[] }
  | { readonly code: 'NOT_FOUND' }
  /** El partido ya empezó (o está guardado) y ese dato ya no se puede cambiar. */
  | { readonly code: 'LOCKED' }
  | { readonly code: 'RESULT_REQUIRED' }

export type DataResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DataError }

export const okResult = <T>(value: T): DataResult<T> => ({ ok: true, value })
export const failResult = <T = never>(error: DataError): DataResult<T> => ({ ok: false, error })
