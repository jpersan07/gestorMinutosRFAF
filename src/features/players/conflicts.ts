import type { PlayerRecord } from '../../data'

/** C-1: el servidor ya tiene otro jugador activo con ese dorsal. */
export function numberTakenMessage(player: Pick<PlayerRecord, 'name' | 'number'>): string {
  return `No se pudo guardar el jugador ${player.name} (${player.number}): el dorsal ya está utilizado por otro jugador en el servidor. Cambia el dorsal para volver a intentarlo.`
}
