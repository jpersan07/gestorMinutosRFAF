import type { EpochMs, Id } from '../../domain'
import type { AppDatabase } from '../db'
import type { AppScope } from '../repositories/account'
import { logError } from '../repositories/errorLog'
import type { Supabase } from '../remote/client'
import type { SyncRemote } from '../remote/syncRemote'
import type { ServerClock } from './clock'
import { withSyncLock } from './lock'
import { pullMatch, runPull } from './pull'
import { runPush, type PushReport } from './push'

export interface SyncContext {
  readonly db: AppDatabase
  readonly supabase: Supabase
  readonly remote: SyncRemote
  readonly scope: AppScope
  readonly clock?: ServerClock
  readonly now?: () => EpochMs
}

export interface SyncReport {
  /** Subida y descarga terminadas sin fallos temporales. */
  readonly ok: boolean
  readonly push: PushReport
  readonly downloaded: number
  /** Partidos en los que este móvil ha perdido el control en esta pasada (subida o descarga). */
  readonly controlLost: readonly Id[]
}

/** Mide la diferencia de reloj con el servidor (si falla, se mantiene la última conocida). */
async function measureClock({ db, remote, clock }: SyncContext): Promise<void> {
  if (!clock) return
  try {
    await clock.measure(() => remote.serverTime(), db)
  } catch (error) {
    await logError(db, error, { at: 'clock' })
  }
}

/**
 * Una pasada de sincronización, en este orden y bajo un único candado:
 *   1. subir lo pendiente;
 *   2. procesar las respuestas y rechazos (cuarentena, CONTROL PERDIDO, conflictos);
 *   3. descargar lo del servidor (la descarga completa además los partidos con CONTROL PERDIDO);
 *   4. el estado local queda actualizado (IndexedDB → la UI se refresca sola).
 * Con `matchId` (modo consulta, cada 5 s) solo se descarga ese partido.
 */
export function syncOnce(context: SyncContext, options: { readonly matchId?: Id } = {}): Promise<SyncReport> {
  return withSyncLock(context.db, async () => {
    await measureClock(context)
    const push = await runPush(context)
    if (options.matchId) {
      let ok = true
      let downloaded = 0
      let lost = false
      try {
        const match = await context.db.matches.get(options.matchId)
        const result = await pullMatch(context, options.matchId, {
          verifyAll: Boolean(match?.controlLostAt && !match.officialStateAt),
        })
        downloaded = result?.outcome.added ?? 0
        lost = Boolean(result?.outcome.controlLost)
      } catch (error) {
        ok = false
        await logError(context.db, error, { at: 'download', matchId: options.matchId })
      }
      const controlLost = [...new Set([...push.controlLost, ...(lost ? [options.matchId] : [])])]
      return { ok: ok && push.ok, push, downloaded, controlLost }
    }
    const pull = await runPull(context)
    return {
      ok: push.ok && pull.ok,
      push,
      downloaded: pull.downloaded,
      controlLost: [...new Set([...push.controlLost, ...pull.controlLost])],
    }
  })
}
