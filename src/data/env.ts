import type { EpochMs, Id } from '../domain'
import { newId } from './ids'

/** Reloj y generador de ids inyectables (los tests usan versiones controladas). */
export interface DataEnv {
  readonly now: () => EpochMs
  readonly newId: () => Id
}

export const systemEnv: DataEnv = { now: () => Date.now(), newId }
