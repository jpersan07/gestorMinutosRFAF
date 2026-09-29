import { decide, replay, type Id } from '../../domain'
import type { DataEnv } from '../env'
import { logError } from '../repositories/errorLog'
import { listMatchEvents } from '../repositories/matchEngine'
import { toRemoteEvent } from '../remote/eventMapping'
import { withSyncLock } from './lock'
import { isControlledBy } from './merge'
import { pullMatch } from './pull'
import { runPush } from './push'
import type { SyncContext } from './sync'

/**
 * Resultado de TOMAR CONTROL. Solo `ok` significa que este móvil controla el partido.
 *   · OFFLINE        → sin conexión: no se ha intentado;
 *   · NETWORK        → no se pudo completar (red o servidor): nada ha cambiado en el móvil;
 *   · TAKEN_BY_OTHER → otro dispositivo tomó el control antes (CONTROL_CHANGED): sigue en consulta;
 *   · NOT_SYNCED     → este móvil tiene cambios del partido sin subir: no se puede tomar;
 *   · BUSY           → el controlador sigue registrando eventos y no dio tiempo: reintentar;
 *   · REJECTED       → el servidor no lo permite (partido guardado, sin preparar…).
 */
export type TakeControlResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'OFFLINE' | 'NETWORK' | 'TAKEN_BY_OTHER' | 'NOT_SYNCED' | 'BUSY' | 'REJECTED'
      readonly detail?: string
    }

/** Intentos si el controlador añade eventos mientras se toma el control (SEQ_CONFLICT). */
const ATTEMPTS = 3

/**
 * TOMAR CONTROL (3d). Requiere conexión. Bajo el candado de sincronización:
 *   1. sube lo pendiente de este móvil;
 *   2. descarga el partido completo (estado oficial);
 *   3. comprueba el control actual (control_epoch descargado);
 *   4. pide al servidor take_match_control(epoch esperado, CONTROL_TAKEN): el servidor lo acepta
 *      solo si el control sigue siendo el que se descargó (operación atómica).
 * El evento NO se guarda en el móvil antes de que el servidor lo acepte: hasta entonces este
 * móvil no es el controlador. Si algo falla, el móvil queda exactamente como estaba.
 */
export function takeControl(
  context: SyncContext & { readonly env: DataEnv; readonly online: boolean },
  matchId: Id,
): Promise<TakeControlResult> {
  const { db, remote, scope, env, clock } = context
  if (!context.online) return Promise.resolve({ ok: false, reason: 'OFFLINE' })

  return withSyncLock(db, async (): Promise<TakeControlResult> => {
    try {
      await runPush(context)
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const pulled = await pullMatch(context, matchId, { verifyAll: attempt === 0 })
        if (!pulled) return { ok: false, reason: 'REJECTED', detail: 'MATCH_NOT_FOUND' }
        const { row } = pulled

        const events = await listMatchEvents(db, matchId)
        if (isControlledBy(events, scope)) return { ok: true }
        if (events.some((e) => e.syncState === 'pending')) return { ok: false, reason: 'NOT_SYNCED' }

        // Referencia de reloj para este periodo de control: medida ahora (o la última conocida).
        const measured = clock ? await clock.measure(() => remote.serverTime(), db).catch(() => null) : null
        const offsetMs = measured ?? clock?.offsetMs ?? env.clockOffsetMs?.() ?? 0
        const deviceNow = env.now() - (env.clockOffsetMs?.() ?? 0)

        const decision = decide(replay(matchId, events), { type: 'TAKE_CONTROL' }, {
          now: deviceNow + offsetMs,
          deviceId: scope.deviceId,
          coachId: scope.userId,
          newId: env.newId,
          squad: [],
        })
        if (!decision.ok) return { ok: false, reason: 'REJECTED', detail: decision.error.code }
        const event = decision.value[0]!

        let result
        try {
          result = await remote.takeControl(matchId, row.control_epoch, toRemoteEvent(event))
        } catch (error) {
          await logError(db, error, { at: 'takeControl', matchId })
          return { ok: false, reason: 'NETWORK' }
        }

        const confirmed = [...result.accepted, ...result.duplicates].includes(event.id)
        if (confirmed) {
          await db.transaction('rw', [db.matches, db.matchEvents], async () => {
            await db.matchEvents.add({ ...event, syncState: 'synced' })
            const all = await listMatchEvents(db, matchId)
            const state = replay(matchId, all)
            await db.matches.update(matchId, {
              status: state.status,
              controllerDeviceId: state.controllerDeviceId,
              managedBy: scope.userId,
              updatedAt: env.now(),
              controlLostAt: null,
              controlLossReason: null,
              controlLossAcknowledgedAt: null,
              officialStateAt: env.now(),
              clockOffset: { ms: offsetMs, controlEventId: event.id },
            })
          })
          return { ok: true }
        }

        const reason = result.rejected?.reason ?? 'UNKNOWN'
        if (reason === 'SEQ_CONFLICT') continue
        if (reason === 'CONTROL_CHANGED') {
          await pullMatch(context, matchId)
          return { ok: false, reason: 'TAKEN_BY_OTHER' }
        }
        return { ok: false, reason: 'REJECTED', detail: reason }
      }
      return { ok: false, reason: 'BUSY' }
    } catch (error) {
      await logError(db, error, { at: 'takeControl', matchId })
      return { ok: false, reason: 'NETWORK' }
    }
  })
}
