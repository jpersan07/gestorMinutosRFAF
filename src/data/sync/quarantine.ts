import { computeMinutes, replay, type EpochMs, type Id } from '../../domain'
import type { AppDatabase, PlayerMatchMinutesRecord, RejectedEventRecord, StoredEvent } from '../db'

/**
 * Eventos que se apartan cuando el servidor rechaza `rejectedId`: ese evento y todos los
 * PENDIENTES posteriores del mismo partido (dependen de él). Los ya aceptados no se tocan.
 */
export function selectEventsToQuarantine(events: readonly StoredEvent[], rejectedId: Id): StoredEvent[] {
  const rejected = events.find((e) => e.id === rejectedId)
  if (!rejected) return []
  return events
    .filter((e) => e.matchId === rejected.matchId && e.syncState === 'pending' && e.seq >= rejected.seq)
    .sort((a, b) => a.seq - b.seq)
}

/**
 * En UNA transacción: mueve los eventos rechazados (y los pendientes posteriores) a la
 * cuarentena, los quita del historial válido, recalcula la caché del partido y los minutos con
 * lo que queda y, si es por control perdido, marca el partido: a partir de ahí no se escribe.
 * Devuelve cuántos eventos se apartaron.
 */
export async function quarantineRejectedEvents(
  db: AppDatabase,
  matchId: Id,
  rejected: { readonly id: Id; readonly reason: string },
  options: { readonly controlLost: boolean; readonly now: EpochMs },
): Promise<number> {
  return db.transaction('rw', [db.matchEvents, db.rejectedEvents, db.matches, db.playerMatchMinutes], async () => {
    const events = await db.matchEvents.where('matchId').equals(matchId).sortBy('seq')
    return moveToQuarantine(db, matchId, selectEventsToQuarantine(events, rejected.id), rejected, options)
  })
}

/**
 * Aparta `toMove` a la cuarentena (nunca se borra nada) y reconstruye la caché y los minutos
 * con los eventos que quedan. Debe llamarse dentro de una transacción con matchEvents,
 * rejectedEvents, matches y playerMatchMinutes. También la usa la descarga (3d) cuando un evento
 * del servidor ocupa el seq de uno local.
 */
export async function moveToQuarantine(
  db: AppDatabase,
  matchId: Id,
  toMove: readonly StoredEvent[],
  rejected: { readonly id: Id; readonly reason: string },
  options: { readonly controlLost: boolean; readonly now: EpochMs },
): Promise<number> {
  const match = await db.matches.get(matchId)
  if (!match) return 0

  if (toMove.length > 0) {
    await db.rejectedEvents.bulkPut(
      toMove.map(({ syncState: _syncState, ...event }): RejectedEventRecord => ({
        id: event.id,
        matchId,
        seq: event.seq,
        event,
        reason: rejected.reason,
        rejectedEventId: rejected.id,
        quarantinedAt: options.now,
      })),
    )
    await db.matchEvents.bulkDelete(toMove.map((e) => e.id))
  }

  const remaining = await db.matchEvents.where('matchId').equals(matchId).sortBy('seq')
  const state = replay(matchId, remaining)
  await db.matches.update(matchId, {
    status: state.status,
    controllerDeviceId: state.controllerDeviceId,
    savedAt: remaining.find((e) => e.type === 'MATCH_SAVED')?.occurredAt ?? null,
    updatedAt: options.now,
    ...(options.controlLost
      ? {
          controlLostAt: match.controlLostAt ?? options.now,
          controlLossReason: match.controlLossReason ?? rejected.reason,
          // El estado oficial (lo que hizo el otro dispositivo) aún no está descargado.
          officialStateAt: null,
          controlLossAcknowledgedAt: null,
        }
      : {}),
  })

  // Minutos: solo a partir de los eventos válidos que quedan. Si este móvil ya no controla el
  // partido, son una vista local ('synced'): nunca se suben (los sube quien lo controla).
  await db.playerMatchMinutes.where('matchId').equals(matchId).delete()
  if (state.status === 'finished' || state.status === 'saved') {
    const rows: PlayerMatchMinutesRecord[] = computeMinutes(remaining).map((p) => ({
      matchId,
      playerId: p.playerId,
      secondsPlayed: p.secondsPlayed,
      minutesPlayed: p.minutesPlayed,
      started: p.started,
      syncState: options.controlLost ? 'synced' : 'pending',
    }))
    await db.playerMatchMinutes.bulkPut(rows)
  }
  return toMove.length
}
