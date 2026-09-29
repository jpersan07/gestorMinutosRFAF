import type { EpochMs, Id } from '../domain'
import { newId } from './ids'

/** Reloj y generador de ids inyectables (los tests usan versiones controladas). */
export interface DataEnv {
  /** Hora estimada del servidor si hay corrección de reloj (ver ServerClock); si no, la del móvil. */
  readonly now: () => EpochMs
  readonly newId: () => Id
  /** Corrección que `now()` ya incluye (ms). Sin ella, 0. */
  readonly clockOffsetMs?: () => number
}

export const systemEnv: DataEnv = { now: () => Date.now(), newId }
