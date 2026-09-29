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
    const toQuarantine = selectEventsToQuarantine(events, rejected.id)
    const match = await db.matches.get(matchId)
    if (!match) return 0

    if (toQuarantine.length > 0) {
      await db.rejectedEvents.bulkPut(
        toQuarantine.map(({ syncState: _syncState, ...event }): RejectedEventRecord => ({
          id: event.id,
          matchId,
          seq: event.seq,
          event,
          reason: rejected.reason,
          rejectedEventId: rejected.id,
          quarantinedAt: options.now,
        })),
      )
      await db.matchEvents.bulkDelete(toQuarantine.map((e) => e.id))
    }

    const removed = new Set(toQuarantine.map((e) => e.id))
    const remaining = events.filter((e) => !removed.has(e.id))
    const state = replay(matchId, remaining)
    await db.matches.update(matchId, {
      status: state.status,
      controllerDeviceId: state.controllerDeviceId,
      savedAt: remaining.find((e) => e.type === 'MATCH_SAVED')?.occurredAt ?? null,
      updatedAt: options.now,
      ...(options.controlLost ? { controlLostAt: options.now, controlLossReason: rejected.reason } : {}),
    })

    // Minutos: solo a partir de los eventos válidos que quedan.
    await db.playerMatchMinutes.where('matchId').equals(matchId).delete()
    if (state.status === 'finished' || state.status === 'saved') {
      const rows: PlayerMatchMinutesRecord[] = computeMinutes(remaining).map((p) => ({
        matchId,
        playerId: p.playerId,
        secondsPlayed: p.secondsPlayed,
        minutesPlayed: p.minutesPlayed,
        started: p.started,
        syncState: 'pending',
      }))
      await db.playerMatchMinutes.bulkPut(rows)
    }
    return toQuarantine.length
  })
}
