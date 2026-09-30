import type { Table } from 'dexie'
import type { EpochMs, Id } from '../../domain'
import type { AppDatabase, StoredEvent, SyncIssue } from '../db'
import type { AppScope } from '../repositories/account'
import { logError } from '../repositories/errorLog'
import type { Supabase } from '../remote/client'
import type { Json } from '../remote/database.types'
import { toRemoteEvent } from '../remote/eventMapping'
import type { AppendResult } from '../remote/syncRemote'
import { classifyEventRejection, classifyRowError } from './classify'
import { crestUpload, errorLogRow, matchRow, minutesRow, playerRow, reportRow, squadRow } from './mapping'
import { withSyncLock } from './lock'
import { quarantineRejectedEvents } from './quarantine'

export interface PushContext {
  readonly db: AppDatabase
  readonly supabase: Supabase
  readonly scope: AppScope
  readonly now?: () => EpochMs
}

export interface PushReport {
  /** Todo lo intentado ha terminado bien o en un estado definitivo (sin fallos temporales). */
  readonly ok: boolean
  readonly uploaded: number
  /** Datos editables que el servidor ha rechazado en esta pasada (C-1, C-2). */
  readonly newConflicts: number
  /** Partidos en los que este dispositivo ha perdido el control en esta pasada. */
  readonly controlLost: readonly Id[]
  readonly quarantined: number
}

/** Máximo de eventos por llamada a append_match_events. */
const EVENTS_PER_CALL = 100
const ERRORS_PER_CALL = 50

/**
 * Una pasada de subida (orden §2 del plan 3c). Nunca lanza por problemas de red o del
 * servidor: lo que no se pueda subir queda pendiente para la siguiente pasada.
 */
export function pushOnce(context: PushContext): Promise<PushReport> {
  return withSyncLock(context.db, () => runPush(context))
}

/** Subida SIN el candado: solo dentro de withSyncLock (pasada completa, TOMAR CONTROL). */
export async function runPush({ db, supabase, scope, now = () => Date.now() }: PushContext): Promise<PushReport> {
  let uploaded = 0
  let newConflicts = 0
  let transientFailures = 0
  let quarantined = 0
  const controlLost: Id[] = []

  const failed = async (error: unknown, context: Record<string, unknown>) => {
    transientFailures++
    await logError(db, error, { at: 'sync', ...context })
  }

  /** Marca 'synced' solo si la fila no ha cambiado desde que se leyó (si cambió, sigue pendiente). */
  const markIfUnchanged = async <T, K>(
    table: Table<T, K>,
    key: K,
    snapshot: T,
    unchanged: (current: T, snapshot: T) => boolean,
    changes: { syncState: 'synced' | 'conflict'; syncIssue: SyncIssue | null },
  ) => {
    await db.transaction('rw', table, async () => {
      const current = await table.get(key as never)
      // Cast: los genéricos de update() de Dexie no se infieren con una tabla genérica.
      if (current && unchanged(current, snapshot)) await table.update(key as never, changes as never)
    })
  }
  const synced = { syncState: 'synced' as const, syncIssue: null }
  const conflict = (issue: SyncIssue) => ({ syncState: 'conflict' as const, syncIssue: issue })

  // 1. Jugadores ------------------------------------------------------------------------------
  const players = await db.players.where('syncState').equals('pending').filter((p) => p.teamId === scope.teamId).toArray()
  for (const player of players) {
    try {
      const { error } = await supabase.from('players').upsert(playerRow(player))
      const sameVersion = (a: typeof player, b: typeof player) => a.updatedAt === b.updatedAt
      if (!error) {
        await markIfUnchanged(db.players, player.id, player, sameVersion, synced)
        uploaded++
        continue
      }
      const failure = classifyRowError(error)
      if (failure.kind === 'conflict') {
        await markIfUnchanged(db.players, player.id, player, sameVersion, conflict(failure.issue))
        newConflicts++
      } else await failed(error, { table: 'players', id: player.id })
    } catch (error) {
      await failed(error, { table: 'players', id: player.id })
    }
  }

  // 2. Escudos → Supabase Storage + referencia ------------------------------------------------
  const crests = await db.crests.where('syncState').equals('pending').toArray()
  for (const crest of crests) {
    try {
      const upload = crestUpload(crest, scope.teamId)
      if (!upload) {
        await failed(new Error('Escudo con formato no válido'), { table: 'crests', id: crest.id })
        continue
      }
      const stored = await supabase.storage
        .from('crests')
        .upload(upload.path, upload.bytes, { contentType: upload.contentType, upsert: false })
      // Ya subido en un intento anterior (los escudos son inmutables): se da por bueno.
      const alreadyThere = stored.error && /exists|duplicate/i.test(stored.error.message)
      if (stored.error && !alreadyThere) {
        await failed(stored.error, { table: 'crests', id: crest.id })
        continue
      }
      const { error } = await supabase.from('crests').upsert(upload.row, { ignoreDuplicates: true })
      if (error) {
        await failed(error, { table: 'crests', id: crest.id })
        continue
      }
      await markIfUnchanged(db.crests, crest.id, crest, (a, b) => a.updatedAt === b.updatedAt, synced)
      uploaded++
    } catch (error) {
      await failed(error, { table: 'crests', id: crest.id })
    }
  }

  // 3. Datos del partido (nunca su estado) ----------------------------------------------------
  const matches = await db.matches.where('syncState').equals('pending').filter((m) => m.teamId === scope.teamId).toArray()
  for (const match of matches) {
    try {
      const { error } = await supabase.from('matches').upsert(matchRow(match))
      const sameDetails = (a: typeof match, b: typeof match) => a.detailsUpdatedAt === b.detailsUpdatedAt
      if (!error) {
        await markIfUnchanged(db.matches, match.id, match, sameDetails, synced)
        uploaded++
        continue
      }
      const failure = classifyRowError(error)
      if (failure.kind === 'conflict') {
        await markIfUnchanged(db.matches, match.id, match, sameDetails, conflict(failure.issue))
        newConflicts++
      } else await failed(error, { table: 'matches', id: match.id })
    } catch (error) {
      await failed(error, { table: 'matches', id: match.id })
    }
  }

  // 4. Convocatorias --------------------------------------------------------------------------
  const squads = await db.matchSquads.where('syncState').equals('pending').toArray()
  for (const squad of squads) {
    try {
      const { error } = await supabase.from('match_squads').upsert(squadRow(squad, scope.teamId))
      const sameVersion = (a: typeof squad, b: typeof squad) => a.updatedAt === b.updatedAt
      if (!error) {
        await markIfUnchanged(db.matchSquads, squad.matchId, squad, sameVersion, synced)
        uploaded++
        continue
      }
      const failure = classifyRowError(error)
      if (failure.kind === 'conflict') {
        await markIfUnchanged(db.matchSquads, squad.matchId, squad, sameVersion, conflict(failure.issue))
        newConflicts++
      } else await failed(error, { table: 'match_squads', id: squad.matchId })
    } catch (error) {
      await failed(error, { table: 'match_squads', id: squad.matchId })
    }
  }

  // 6. Informe y minutos de un partido (también desde 5, antes de enviar MATCH_SAVED) ---------
  const pushReportAndMinutes = async (matchId?: Id) => {
    const reports = await db.matchReports
      .where('syncState')
      .equals('pending')
      .filter((r) => matchId === undefined || r.matchId === matchId)
      .toArray()
    for (const report of reports) {
      try {
        const { error } = await supabase.from('match_reports').upsert(reportRow(report, scope.teamId))
        const sameVersion = (a: typeof report, b: typeof report) => a.updatedAt === b.updatedAt
        if (!error) {
          await markIfUnchanged(db.matchReports, report.matchId, report, sameVersion, synced)
          uploaded++
          continue
        }
        const failure = classifyRowError(error)
        if (failure.kind === 'conflict') {
          await markIfUnchanged(db.matchReports, report.matchId, report, sameVersion, conflict(failure.issue))
          newConflicts++
        } else await failed(error, { table: 'match_reports', id: report.matchId })
      } catch (error) {
        await failed(error, { table: 'match_reports', id: report.matchId })
      }
    }

    const minutes = await db.playerMatchMinutes
      .where('syncState')
      .equals('pending')
      .filter((r) => matchId === undefined || r.matchId === matchId)
      .toArray()
    const byMatch = new Map<Id, typeof minutes>()
    for (const row of minutes) byMatch.set(row.matchId, [...(byMatch.get(row.matchId) ?? []), row])
    for (const [id, rows] of byMatch) {
      try {
        const { error } = await supabase
          .from('player_match_minutes')
          .upsert(rows.map((row) => minutesRow(row, scope.teamId, now())))
        const sameValues = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
          a.secondsPlayed === b.secondsPlayed && a.minutesPlayed === b.minutesPlayed && a.started === b.started
        if (!error) {
          for (const row of rows) {
            await markIfUnchanged(db.playerMatchMinutes, [row.matchId, row.playerId] as [Id, Id], row, sameValues, synced)
          }
          uploaded += rows.length
          continue
        }
        const failure = classifyRowError(error)
        if (failure.kind === 'conflict') {
          for (const row of rows) {
            await markIfUnchanged(db.playerMatchMinutes, [row.matchId, row.playerId] as [Id, Id], row, sameValues, conflict(failure.issue))
          }
          newConflicts++
        } else await failed(error, { table: 'player_match_minutes', id })
      } catch (error) {
        await failed(error, { table: 'player_match_minutes', id })
      }
    }
  }

  /**
   * ¿El servidor ha ACEPTADO el informe y los minutos de este partido? Se suben primero y solo
   * cuenta lo confirmado: nada pendiente ni rechazado en el móvil.
   */
  const reportAndMinutesAccepted = async (matchId: Id): Promise<boolean> => {
    await pushReportAndMinutes(matchId)
    const report = await db.matchReports.get(matchId)
    const minutesNotAccepted = await db.playerMatchMinutes
      .where('matchId')
      .equals(matchId)
      .filter((row) => row.syncState !== 'synced')
      .count()
    return (!report || report.syncState === 'synced') && minutesNotAccepted === 0
  }

  // 5. Eventos: por partido, en orden de seq, SOLO mediante append_match_events ---------------
  //
  // MATCH_SAVED bloquea el partido en el servidor: después ya no acepta cambios en el informe ni
  // en los minutos (MATCH_LOCKED) y la descarga dejaría en el móvil la versión anterior del
  // servidor. Por eso se suben primero los eventos anteriores, después el informe y los minutos,
  // y MATCH_SAVED solo cuando el servidor los ha aceptado. Si algo falla (p. ej. sin red),
  // MATCH_SAVED queda pendiente para la siguiente pasada, que repite el mismo orden.
  const pendingEvents = await db.matchEvents.where('syncState').equals('pending').toArray()
  const matchIds = [...new Set(pendingEvents.map((e) => e.matchId))]
  for (const matchId of matchIds) {
    const match = await db.matches.get(matchId)
    if (!match || match.controlLostAt) continue

    /** Informe y minutos de este partido ya aceptados por el servidor en esta pasada. */
    let reportAccepted = false
    for (;;) {
      const pending: StoredEvent[] = (await db.matchEvents.where('matchId').equals(matchId).sortBy('seq')).filter(
        (e) => e.syncState === 'pending',
      )
      if (pending.length === 0) break
      const saveAt = pending.findIndex((e) => e.type === 'MATCH_SAVED')
      if (saveAt === 0) {
        if (!reportAccepted && !(await reportAndMinutesAccepted(matchId))) {
          transientFailures++
          break
        }
        reportAccepted = true
      }
      const batch = pending.slice(0, saveAt > 0 ? Math.min(saveAt, EVENTS_PER_CALL) : EVENTS_PER_CALL)

      let result: AppendResult
      try {
        const { data, error } = await supabase.rpc('append_match_events', {
          p_match_id: matchId,
          p_events: batch.map((e) => toRemoteEvent(e)) as unknown as Json,
        })
        if (error) {
          await failed(error, { table: 'match_events', matchId })
          break
        }
        result = data as unknown as AppendResult
      } catch (error) {
        await failed(error, { table: 'match_events', matchId })
        break
      }

      const confirmed = [...result.accepted, ...result.duplicates]
      if (confirmed.length > 0) {
        await db.transaction('rw', db.matchEvents, async () => {
          for (const id of confirmed) await db.matchEvents.update(id, { syncState: 'synced' })
        })
        uploaded += result.accepted.length
      }

      if (!result.rejected) {
        if (pending.length > batch.length) continue
        break
      }

      const kind = classifyEventRejection(result.rejected.reason)
      if (kind === 'control-lost' || kind === 'invalid') {
        quarantined += await quarantineRejectedEvents(db, matchId, result.rejected, {
          controlLost: kind === 'control-lost',
          now: now(),
        })
        if (kind === 'control-lost') controlLost.push(matchId)
        else await logError(db, new Error(`Evento rechazado por el servidor: ${result.rejected.reason}`), { matchId })
        break
      }
      transientFailures++
      break
    }
  }

  await pushReportAndMinutes()

  // 7. Errores técnicos (C-5): se suben y, confirmados, se borran del móvil --------------------
  try {
    const entries = await db.errorLog.orderBy('id').limit(ERRORS_PER_CALL).toArray()
    if (entries.length > 0) {
      const { error } = await supabase
        .from('client_logs')
        .insert(entries.map((entry) => errorLogRow(entry, scope.teamId, scope.deviceId)))
      if (!error) await db.errorLog.bulkDelete(entries.flatMap((e) => (e.id === undefined ? [] : [e.id])))
      else transientFailures++
    }
  } catch {
    transientFailures++
  }

  return { ok: transientFailures === 0, uploaded, newConflicts, controlLost, quarantined }
}

/** Cambios que faltan por subir (datos deportivos; no cuenta el registro de errores). */
export async function countPending(db: AppDatabase): Promise<number> {
  const counts = await Promise.all([
    db.players.where('syncState').equals('pending').count(),
    db.crests.where('syncState').equals('pending').count(),
    db.matches.where('syncState').equals('pending').count(),
    db.matchSquads.where('syncState').equals('pending').count(),
    db.matchEvents.where('syncState').equals('pending').count(),
    db.matchReports.where('syncState').equals('pending').count(),
    db.playerMatchMinutes.where('syncState').equals('pending').count(),
  ])
  return counts.reduce((a, b) => a + b, 0)
}

/** Datos que el servidor ha rechazado y esperan a que el entrenador los cambie. */
export async function countConflicts(db: AppDatabase): Promise<number> {
  const counts = await Promise.all([
    db.players.where('syncState').equals('conflict').count(),
    db.matches.where('syncState').equals('conflict').count(),
    db.matchSquads.where('syncState').equals('conflict').count(),
    db.matchReports.where('syncState').equals('conflict').count(),
    db.playerMatchMinutes.where('syncState').equals('conflict').count(),
  ])
  return counts.reduce((a, b) => a + b, 0)
}
