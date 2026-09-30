import type { EpochMs } from '../../domain'
import type { DataEnv } from '../env'

/**
 * Versión (hora de edición) de un dato editable que ya existía: la que decide "gana el último"
 * en el servidor y en la descarga.
 *
 * Es la hora corregida con la del servidor, pero SIEMPRE posterior a la versión anterior del
 * mismo registro. Esa hora puede ir hacia atrás (reloj del móvil mal o cambiado, corrección con el
 * servidor que se vuelve a medir…) y entonces la edición nueva quedaría "más antigua" que la
 * anterior: el servidor la ignoraría y la descarga la sustituiría por la anterior, sin avisar.
 * Solo depende de la versión anterior y de la hora: dos ediciones seguidas nunca comparten versión.
 */
export function editVersion(env: DataEnv, previous: EpochMs | null | undefined): EpochMs {
  const now = env.now()
  return previous === null || previous === undefined ? now : Math.max(now, previous + 1)
}
