import type { Id, MatchEvent } from '../../domain'
import type { AppDatabase, MatchRecord } from '../db'
import type { DataEnv } from '../env'
import { failResult, okResult, type DataResult } from '../errors'
import { isControlledBy, type Me } from '../sync/merge'
import { listMatchEvents } from './matchEngine'

/**
 * ¿Puede cerrarse el aviso de CONTROL PERDIDO (ENTENDIDO)? Solo cuando el móvil ya tiene el
 * estado OFICIAL del partido (todos los eventos del servidor) y, según ese estado, lo controla
 * otro dispositivo. Así nunca se cierra con un estado a medias ni vuelve a creerse controlador.
 */
export function canAcknowledgeControlLoss(
  match: Pick<MatchRecord, 'controlLostAt' | 'officialStateAt'>,
  events: readonly MatchEvent[],
  me: Me,
): boolean {
  return Boolean(match.controlLostAt) && Boolean(match.officialStateAt) && !isControlledBy(events, me)
}

/**
 * ENTENDIDO: el entrenador ha visto la pérdida de control. Solo oculta el aviso: el partido
 * sigue en modo consulta y este móvil sigue sin poder escribir (controlLostAt se mantiene hasta
 * que el servidor acepte un TOMAR CONTROL de este móvil).
 */
export async function acknowledgeControlLoss(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  me: Me,
): Promise<DataResult<void>> {
  return db.transaction('rw', [db.matches, db.matchEvents], async () => {
    const match = await db.matches.get(matchId)
    if (!match) return failResult({ code: 'NOT_FOUND' })
    if (!canAcknowledgeControlLoss(match, await listMatchEvents(db, matchId), me)) {
      return failResult({ code: 'OFFICIAL_STATE_PENDING' })
    }
    await db.matches.update(matchId, { controlLossAcknowledgedAt: env.now() })
    return okResult(undefined)
  })
}
