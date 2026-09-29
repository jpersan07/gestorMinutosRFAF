import type { EpochMs, Id } from '../../domain'
import type { AppDatabase } from '../db'
import type { AppScope } from '../repositories/account'
import { logError } from '../repositories/errorLog'
import { fromRemoteEvent } from '../remote/eventMapping'
import type { EditableTable, ServerRow, SyncRemote } from '../remote/syncRemote'
import {
  localSyncedSeq,
  mergeMatchDetails,
  mergeMinutes,
  mergePlayers,
  mergeReports,
  mergeServerEvents,
  mergeSquads,
  mergeTeamSnapshot,
  type EventMergeOutcome,
  type Me,
} from './merge'

// Descarga (bloque 3d). Siempre DESPUÉS de la subida y bajo el mismo candado (ver sync.ts).
//
//   · Datos editables: por tabla, filas con synced_at (hora del SERVIDOR) posterior al cursor
//     guardado, menos un margen de 2 minutos (transacciones concurrentes pueden confirmar fuera
//     de orden). Repetir filas no importa: la fusión es idempotente. El cursor solo avanza si
//     todo lo de esa tabla se ha guardado.
//   · Eventos: NO usan la hora. Cada evento aceptado actualiza matches.last_seq, así que por
//     partido se piden los de seq > último seq local ya sincronizado. El servidor garantiza que
//     el historial no tiene huecos (trigger a_contiguous_seq), así que no se pierde ninguno.

export interface PullContext {
  readonly db: AppDatabase
  readonly remote: SyncRemote
  readonly scope: AppScope
  readonly now?: () => EpochMs
}

export interface PullReport {
  /** Todo se ha descargado y guardado (sin fallos temporales). */
  readonly ok: boolean
  readonly downloaded: number
  /** Partidos en los que la descarga ha revelado que este móvil ya no controla el partido. */
  readonly controlLost: readonly Id[]
}

/** Margen de seguridad del cursor. */
export const CURSOR_OVERLAP_MS = 2 * 60_000

const cursorKey = (teamId: Id, table: EditableTable) => `cursor:${teamId}:${table}`

async function readCursor(db: AppDatabase, teamId: Id, table: EditableTable): Promise<string | null> {
  const value = (await db.meta.get(cursorKey(teamId, table)))?.value
  return typeof value === 'string' ? value : null
}

/** Desde dónde pedir: el cursor menos el margen (null = todo, móvil nuevo). */
export function sinceWithOverlap(cursor: string | null): string | null {
  if (!cursor) return null
  const time = Date.parse(cursor)
  return Number.isFinite(time) ? new Date(time - CURSOR_OVERLAP_MS).toISOString() : null
}

/** Nuevo cursor: el mayor synced_at recibido (nunca retrocede). */
function nextCursor(current: string | null, rows: ReadonlyArray<{ readonly synced_at: string }>): string | null {
  let best = current
  for (const row of rows) {
    if (!best || Date.parse(row.synced_at) > Date.parse(best)) best = row.synced_at
  }
  return best
}

const meOf = (scope: AppScope): Me => ({ deviceId: scope.deviceId, userId: scope.userId })

/**
 * Descarga un partido concreto: su fila, sus eventos (desde el último seq sincronizado, o
 * todos con `verifyAll`), convocatoria, informe y minutos. Sin candado: la llama la pasada
 * completa, la de modo consulta y TOMAR CONTROL, que ya lo tienen.
 */
export async function pullMatch(
  context: PullContext,
  matchId: Id,
  options: { readonly verifyAll?: boolean } = {},
): Promise<{ readonly row: ServerRow<'matches'>; readonly outcome: EventMergeOutcome } | null> {
  const { db, remote, now = () => Date.now() } = context
  const row = await remote.match(matchId)
  if (!row) return null
  await mergeMatchDetails(db, [row], now())
  const outcome = await pullMatchEvents(context, row, options.verifyAll ?? false)
  const data = await remote.matchData(matchId)
  if (data.squad) await mergeSquads(db, [data.squad])
  if (data.report) await mergeReports(db, [data.report])
  await mergeMinutes(db, data.minutes)
  return { row, outcome }
}

async function pullMatchEvents(
  { db, remote, scope, now = () => Date.now() }: PullContext,
  row: ServerRow<'matches'>,
  verifyAll: boolean,
): Promise<EventMergeOutcome> {
  const after = verifyAll ? 0 : await localSyncedSeq(db, row.id)
  const rows = row.last_seq > after ? await remote.matchEventsAfter(row.id, after) : []
  return mergeServerEvents(db, row.id, rows.map(fromRemoteEvent), {
    me: meOf(scope),
    serverLastSeq: row.last_seq,
    now: now(),
  })
}

/** Pasada completa de descarga del equipo. Nunca lanza: lo que falle se reintenta después. */
export async function runPull(context: PullContext): Promise<PullReport> {
  const { db, remote, scope, now = () => Date.now() } = context
  const teamId = scope.teamId
  let ok = true
  let downloaded = 0
  const controlLost = new Set<Id>()

  const failed = async (error: unknown, where: Record<string, unknown>) => {
    ok = false
    await logError(db, error, { at: 'download', ...where })
  }

  /** Descarga una tabla editable por cursor y la fusiona; el cursor avanza solo si todo va bien. */
  const table = async <T extends EditableTable>(
    name: T,
    merge: (rows: Array<ServerRow<T>>) => Promise<number>,
    afterMerge?: (rows: Array<ServerRow<T>>) => Promise<boolean>,
  ) => {
    try {
      const cursor = await readCursor(db, teamId, name)
      const rows = await remote.changedSince(name, teamId, sinceWithOverlap(cursor))
      downloaded += await merge(rows)
      if (afterMerge && !(await afterMerge(rows))) return
      const next = nextCursor(cursor, rows)
      if (next && next !== cursor) await db.meta.put({ key: cursorKey(teamId, name), value: next })
    } catch (error) {
      await failed(error, { table: name })
    }
  }

  // 1. Equipo, temporadas y miembros.
  try {
    await mergeTeamSnapshot(db, await remote.teamSnapshot(teamId), now())
  } catch (error) {
    await failed(error, { table: 'teams' })
  }

  // 2. Jugadores.
  await table('players', (rows) => mergePlayers(db, rows))

  // 3. Partidos (datos editables) y, para los que tienen eventos nuevos, sus eventos.
  const handled = new Set<Id>()
  await table(
    'matches',
    (rows) => mergeMatchDetails(db, rows, now()),
    async (rows) => {
      let allEvents = true
      for (const row of rows) {
        handled.add(row.id)
        try {
          const local = await db.matches.get(row.id)
          const behind = row.last_seq > (await localSyncedSeq(db, row.id))
          if (!behind && !(local?.controlLostAt && !local.officialStateAt)) continue
          const outcome = await pullMatchEvents(context, row, Boolean(local?.controlLostAt && !local.officialStateAt))
          downloaded += outcome.added
          if (outcome.controlLost) controlLost.add(row.id)
        } catch (error) {
          allEvents = false
          await failed(error, { table: 'match_events', matchId: row.id })
        }
      }
      return allEvents
    },
  )

  // 4. Partidos con CONTROL PERDIDO cuyo estado oficial aún no está en el móvil: se recargan
  //    completos desde el servidor (todos sus eventos, comprobando los que ya había).
  const lost = await db.matches
    .where('teamId')
    .equals(teamId)
    .filter((m) => Boolean(m.controlLostAt) && !m.officialStateAt && !handled.has(m.id))
    .toArray()
  for (const match of lost) {
    try {
      const result = await pullMatch(context, match.id, { verifyAll: true })
      if (result?.outcome.controlLost) controlLost.add(match.id)
    } catch (error) {
      await failed(error, { table: 'match_events', matchId: match.id })
    }
  }

  // 5. Convocatorias, informes y minutos.
  await table('match_squads', (rows) => mergeSquads(db, rows))
  await table('match_reports', (rows) => mergeReports(db, rows))
  await table('player_match_minutes', (rows) => mergeMinutes(db, rows))

  // 6. Imágenes de escudo que usa algún partido y aún no están en el móvil.
  try {
    downloaded += await downloadMissingCrests(context)
  } catch (error) {
    await failed(error, { table: 'crests' })
  }

  return { ok, downloaded, controlLost: [...controlLost] }
}

async function downloadMissingCrests({ db, remote, scope }: PullContext): Promise<number> {
  const matches = await db.matches.where('teamId').equals(scope.teamId).toArray()
  const referenced = [...new Set(matches.flatMap((m) => (m.crestId ? [m.crestId] : [])))]
  const present = new Set((await db.crests.bulkGet(referenced)).flatMap((c) => (c ? [c.id] : [])))
  const missing = referenced.filter((id) => !present.has(id))
  if (missing.length === 0) return 0
  let count = 0
  for (const row of await remote.crests(missing)) {
    const blob = await remote.crestImage(row.storage_path)
    const createdAt = Date.parse(row.created_at)
    await db.crests.put({
      id: row.id,
      dataUrl: await blobToDataUrl(blob, row.mime_type),
      createdAt,
      updatedAt: createdAt,
      syncState: 'synced',
    })
    count++
  }
  return count
}

/** Imagen → data URL (el formato local de los escudos). Funciona en el navegador y en Node. */
export async function blobToDataUrl(blob: Blob, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mimeType};base64,${btoa(binary)}`
}
