import { computeMinutes, replay, type EpochMs, type Id, type MatchEvent } from '../../domain'
import type {
  AppDatabase,
  MatchRecord,
  MatchReportRecord,
  MatchSquadRecord,
  PlayerMatchMinutesRecord,
  PlayerRecord,
  StoredEvent,
  SyncIssue,
  SyncState,
} from '../db'
import { logError } from '../repositories/errorLog'
import type { ServerRow, TeamSnapshot } from '../remote/syncRemote'
import { lastControlEvent } from './clock'
import { moveToQuarantine } from './quarantine'

// Fusión de lo descargado del servidor con los datos del móvil (bloque 3d).
//
//   · EVENTOS: nunca "gana el último". Un evento del servidor se AÑADE si falta; uno que ya
//     está no se toca. Si un evento del servidor ocupa el seq de uno local distinto, el local
//     (y todo lo posterior) va a la cuarentena y el partido queda CONTROL PERDIDO.
//   · DATOS EDITABLES: la misma regla que aplica el servidor (last_write_wins): un cambio local
//     pendiente solo se sustituye si el servidor tiene una versión estrictamente más reciente.

/** Este dispositivo con esta cuenta: así identifica el servidor al controlador de un partido. */
export interface Me {
  readonly deviceId: string
  readonly userId: Id
}

const ms = (iso: string): EpochMs => Date.parse(iso)

/** "HH:MM:SS" del servidor → "HH:MM" de la app. */
const hhmm = (time: string | null): string | null => (time ? time.slice(0, 5) : null)

/** ¿Controla este dispositivo (con esta cuenta) el partido según estos eventos? */
export function isControlledBy(events: readonly MatchEvent[], me: Me): boolean {
  const control = lastControlEvent(events)
  return control !== undefined && control.deviceId === me.deviceId && control.coachId === me.userId
}

interface LocalVersion {
  readonly syncState: SyncState
  readonly syncIssue?: SyncIssue | null
  /** Hora de la última edición (updated_at en el servidor). */
  readonly version: EpochMs
}

/**
 * ¿Se sustituye la versión local por la del servidor? Refleja la regla del servidor:
 *   · sin versión local, o ya sincronizada → la del servidor;
 *   · pendiente → solo si la del servidor es ESTRICTAMENTE más reciente (si no, la local se
 *     sube en la siguiente pasada y el servidor la acepta: last_write_wins ignora lo anterior);
 *   · partido bloqueado (C-2) → la del servidor, que es definitiva;
 *   · dorsal ocupado (C-1) → se mantiene hasta que el entrenador lo cambie.
 */
export function adoptServerVersion(local: LocalVersion | undefined, serverVersion: EpochMs): boolean {
  if (!local) return true
  if (local.syncState === 'conflict') return local.syncIssue === 'MATCH_LOCKED'
  if (local.syncState === 'pending') return serverVersion > local.version
  return serverVersion !== local.version
}

/** Si la versión local era un conflicto de partido bloqueado, el aviso se conserva. */
const lockedNotice = (local: LocalVersion | undefined): SyncIssue | null =>
  local?.syncIssue === 'MATCH_LOCKED' ? 'MATCH_LOCKED' : null

// ---------------------------------------------------------------------------------------------
// Equipo, temporadas y miembros (solo lectura en el móvil)
// ---------------------------------------------------------------------------------------------

export async function mergeTeamSnapshot(db: AppDatabase, snapshot: TeamSnapshot, now: EpochMs): Promise<void> {
  await db.transaction('rw', [db.teams, db.seasons, db.profiles, db.teamMembers], async () => {
    const { team } = snapshot
    await db.teams.put({ id: team.id, name: team.name, currentSeasonId: team.currentSeasonId, updatedAt: now })
    await db.seasons.bulkPut(snapshot.seasons.map((s) => ({ id: s.id, teamId: team.id, name: s.name, updatedAt: now })))
    await db.profiles.bulkPut(snapshot.members.map((m) => ({ id: m.userId, displayName: m.displayName, updatedAt: now })))
    await db.teamMembers.where('teamId').equals(team.id).delete()
    await db.teamMembers.bulkPut(snapshot.members.map((m) => ({ teamId: team.id, userId: m.userId, role: m.role })))
  })
}

// ---------------------------------------------------------------------------------------------
// Datos editables
// ---------------------------------------------------------------------------------------------

export async function mergePlayers(db: AppDatabase, rows: ReadonlyArray<ServerRow<'players'>>): Promise<number> {
  let changed = 0
  await db.transaction('rw', db.players, async () => {
    for (const row of rows) {
      const local = await db.players.get(row.id)
      const version = ms(row.updated_at)
      if (!adoptServerVersion(local && { ...local, version: local.updatedAt }, version)) continue
      const player: PlayerRecord = {
        id: row.id,
        teamId: row.team_id,
        name: row.name,
        number: row.number,
        active: row.active,
        createdAt: ms(row.created_at),
        updatedAt: version,
        syncState: 'synced',
        syncIssue: null,
      }
      await db.players.put(player)
      changed++
    }
  })
  return changed
}

/**
 * Datos editables del partido (rival, escudo, fecha, hora, ubicación). El estado y el control
 * NUNCA se copian de aquí: se derivan de los eventos (mergeServerEvents).
 */
export async function mergeMatchDetails(
  db: AppDatabase,
  rows: ReadonlyArray<ServerRow<'matches'>>,
  now: EpochMs,
): Promise<number> {
  let changed = 0
  await db.transaction('rw', db.matches, async () => {
    for (const row of rows) {
      const local = await db.matches.get(row.id)
      const version = ms(row.updated_at)
      const localVersion = local && { ...local, version: local.detailsUpdatedAt ?? local.createdAt }
      if (!adoptServerVersion(localVersion, version)) continue
      const details = {
        opponent: row.opponent,
        crestId: row.crest_id,
        matchDate: row.match_date,
        kickoffTime: hhmm(row.kickoff_time),
        location: row.location,
        detailsUpdatedAt: version,
        syncState: 'synced' as const,
        syncIssue: lockedNotice(localVersion),
      }
      if (local) {
        await db.matches.put({ ...local, ...details })
      } else {
        const match: MatchRecord = {
          id: row.id,
          teamId: row.team_id,
          seasonId: row.season_id,
          ...details,
          // Caché del estado: se recalcula con los eventos del partido al descargarlos.
          status: 'scheduled',
          managedBy: null,
          controllerDeviceId: null,
          savedAt: null,
          createdAt: ms(row.created_at),
          updatedAt: now,
        }
        await db.matches.add(match)
      }
      changed++
    }
  })
  return changed
}

export async function mergeSquads(db: AppDatabase, rows: ReadonlyArray<ServerRow<'match_squads'>>): Promise<number> {
  let changed = 0
  await db.transaction('rw', db.matchSquads, async () => {
    for (const row of rows) {
      const local = await db.matchSquads.get(row.match_id)
      const version = ms(row.updated_at)
      const localVersion = local && { ...local, version: local.updatedAt }
      if (!adoptServerVersion(localVersion, version)) continue
      const squad: MatchSquadRecord = {
        matchId: row.match_id,
        playerIds: row.player_ids,
        updatedAt: version,
        updatedBy: row.updated_by,
        syncState: 'synced',
        syncIssue: lockedNotice(localVersion),
      }
      await db.matchSquads.put(squad)
      changed++
    }
  })
  return changed
}

export async function mergeReports(db: AppDatabase, rows: ReadonlyArray<ServerRow<'match_reports'>>): Promise<number> {
  let changed = 0
  await db.transaction('rw', db.matchReports, async () => {
    for (const row of rows) {
      const local = await db.matchReports.get(row.match_id)
      const version = ms(row.updated_at)
      if (!adoptServerVersion(local && { ...local, version: local.updatedAt }, version)) continue
      const report: MatchReportRecord = {
        matchId: row.match_id,
        result: row.result,
        observations: row.observations,
        updatedAt: version,
        updatedBy: row.updated_by,
        syncState: 'synced',
        syncIssue: null,
      }
      await db.matchReports.put(report)
      changed++
    }
  })
  return changed
}

/** Minutos: la proyección local pendiente (del móvil que controla) se sube; el resto, del servidor. */
export async function mergeMinutes(
  db: AppDatabase,
  rows: ReadonlyArray<ServerRow<'player_match_minutes'>>,
): Promise<number> {
  let changed = 0
  await db.transaction('rw', db.playerMatchMinutes, async () => {
    for (const row of rows) {
      const local = await db.playerMatchMinutes.get([row.match_id, row.player_id])
      if (local?.syncState === 'pending') continue
      const same =
        local &&
        local.secondsPlayed === row.seconds_played &&
        local.minutesPlayed === row.minutes_played &&
        local.started === row.started
      if (same) continue
      const minutes: PlayerMatchMinutesRecord = {
        matchId: row.match_id,
        playerId: row.player_id,
        secondsPlayed: row.seconds_played,
        minutesPlayed: row.minutes_played,
        started: row.started,
        syncState: 'synced',
      }
      await db.playerMatchMinutes.put(minutes)
      changed++
    }
  })
  return changed
}

// ---------------------------------------------------------------------------------------------
// Eventos del partido: solo se AÑADEN
// ---------------------------------------------------------------------------------------------

export interface EventMergeOutcome {
  readonly added: number
  readonly quarantined: number
  /** Este móvil ha perdido el control del partido con esta descarga. */
  readonly controlLost: boolean
  /** El historial local es el oficial completo del servidor (hasta serverLastSeq). */
  readonly complete: boolean
}

export class DownloadGapError extends Error {
  readonly matchId: Id
  constructor(matchId: Id) {
    super(`La descarga del partido ${matchId} no es consecutiva`)
    this.matchId = matchId
  }
}

/**
 * Incorpora los eventos del servidor de un partido (en orden de seq), en UNA transacción:
 *   1. seq libre en el móvil → se añade como 'synced';
 *   2. mismo seq y mismo id → ya estaba (si estaba pendiente, queda 'synced');
 *   3. mismo seq y distinto id → gana el servidor: el evento local y TODOS los posteriores van a
 *      la cuarentena (SEQ_CONFLICT si eran pendientes; DIVERGED si ya figuraban como
 *      sincronizados, lo que no debería ocurrir nunca) y se añaden los del servidor.
 * Un evento existente nunca se modifica. Si el historial resultante tuviera un hueco, no se
 * guarda nada (DownloadGapError) y se reintenta en la siguiente pasada.
 */
export async function mergeServerEvents(
  db: AppDatabase,
  matchId: Id,
  serverEvents: readonly MatchEvent[],
  options: { readonly me: Me; readonly serverLastSeq: number; readonly now: EpochMs },
): Promise<EventMergeOutcome> {
  const incoming = [...serverEvents].sort((a, b) => a.seq - b.seq)
  return db.transaction('rw', [db.matches, db.matchEvents, db.rejectedEvents, db.playerMatchMinutes, db.errorLog], async () => {
    const match = await db.matches.get(matchId)
    if (!match) return { added: 0, quarantined: 0, controlLost: false, complete: false }

    const local = await db.matchEvents.where('matchId').equals(matchId).sortBy('seq')
    const wasMine = isControlledBy(local, options.me)
    const bySeq = new Map(local.map((e) => [e.seq, e]))
    const byId = new Map(local.map((e) => [e.id, e]))

    let collision: StoredEvent | undefined
    for (const event of incoming) {
      const sameSeq = bySeq.get(event.seq)
      if (sameSeq && sameSeq.id !== event.id) {
        collision = sameSeq
        break
      }
      const sameId = byId.get(event.id)
      if (!sameSeq && sameId) {
        // El mismo evento con otro seq: el historial local no coincide con el del servidor.
        collision = sameId
        break
      }
    }

    let quarantined = 0
    let lostBySeq = false
    if (collision) {
      const from = collision.seq
      const toMove = local.filter((e) => e.seq >= from)
      const diverged = toMove.some((e) => e.syncState === 'synced')
      lostBySeq = toMove.some((e) => e.syncState === 'pending')
      if (diverged) {
        await logError(db, new Error('Historial local distinto del servidor'), { at: 'download', matchId, seq: from })
      }
      quarantined = await moveToQuarantine(
        db,
        matchId,
        toMove,
        { id: collision.id, reason: diverged ? 'DIVERGED' : 'SEQ_CONFLICT' },
        { controlLost: lostBySeq || wasMine, now: options.now },
      )
    }

    const kept = collision ? local.filter((e) => e.seq < collision.seq) : local
    const keptBySeq = new Map(kept.map((e) => [e.seq, e]))
    const toAdd: StoredEvent[] = []
    const toConfirm: Id[] = []
    for (const event of incoming) {
      const existing = keptBySeq.get(event.seq)
      if (!existing) toAdd.push({ ...event, syncState: 'synced' })
      else if (existing.id === event.id && existing.syncState === 'pending') toConfirm.push(existing.id)
    }

    // Nunca se guarda un historial con huecos.
    const seqs = [...kept.map((e) => e.seq), ...toAdd.map((e) => e.seq)].sort((a, b) => a - b)
    if (seqs.some((seq, i) => seq !== i + 1)) throw new DownloadGapError(matchId)

    if (toAdd.length > 0) await db.matchEvents.bulkAdd(toAdd)
    for (const id of toConfirm) await db.matchEvents.update(id, { syncState: 'synced' })

    const events = await db.matchEvents.where('matchId').equals(matchId).sortBy('seq')
    const state = replay(matchId, events)
    const mineNow = isControlledBy(events, options.me)
    const current = (await db.matches.get(matchId))!
    const controlLost = !current.controlLostAt && wasMine && !mineNow
    // El servidor aceptó un TOMAR CONTROL de este móvil cuya respuesta no llegó: vuelve a controlar.
    const regained =
      Boolean(current.controlLostAt) &&
      mineNow &&
      toAdd.some((e) => e.type === 'CONTROL_TAKEN' && e.deviceId === options.me.deviceId && e.coachId === options.me.userId)
    const complete =
      events.every((e) => e.syncState === 'synced') && (events.at(-1)?.seq ?? 0) >= options.serverLastSeq

    const cacheChanged =
      toAdd.length > 0 ||
      quarantined > 0 ||
      current.status !== state.status ||
      current.controllerDeviceId !== state.controllerDeviceId
    const changes: { -readonly [K in keyof MatchRecord]?: MatchRecord[K] } = {
      ...(cacheChanged
        ? {
            status: state.status,
            controllerDeviceId: state.controllerDeviceId,
            managedBy: lastControlEvent(events)?.coachId ?? current.managedBy,
            savedAt: events.find((e) => e.type === 'MATCH_SAVED')?.occurredAt ?? null,
            updatedAt: options.now,
          }
        : {}),
      ...(controlLost
        ? {
            controlLostAt: options.now,
            controlLossReason: 'TAKEN_BY_OTHER',
            officialStateAt: null,
            controlLossAcknowledgedAt: null,
          }
        : {}),
      ...(regained
        ? { controlLostAt: null, controlLossReason: null, controlLossAcknowledgedAt: null }
        : {}),
    }
    // Estado oficial cargado: a partir de aquí ENTENDIDO está disponible (si procede).
    if (complete && (controlLost || !current.officialStateAt)) changes.officialStateAt = options.now
    if (Object.keys(changes).length > 0) await db.matches.update(matchId, changes)

    // Minutos de un partido que controla otro móvil: vista local, nunca se suben.
    if (toAdd.length > 0 && !mineNow && (state.status === 'finished' || state.status === 'saved')) {
      const pending = await db.playerMatchMinutes.where('matchId').equals(matchId).filter((r) => r.syncState === 'pending').count()
      if (pending === 0) {
        await db.playerMatchMinutes.where('matchId').equals(matchId).delete()
        await db.playerMatchMinutes.bulkPut(
          computeMinutes(events).map((p) => ({
            matchId,
            playerId: p.playerId,
            secondsPlayed: p.secondsPlayed,
            minutesPlayed: p.minutesPlayed,
            started: p.started,
            syncState: 'synced' as const,
          })),
        )
      }
    }

    return { added: toAdd.length, quarantined, controlLost: controlLost || lostBySeq, complete }
  })
}

/** Último seq que el servidor ya tiene de este partido según el móvil (eventos 'synced'). */
export async function localSyncedSeq(db: AppDatabase, matchId: Id): Promise<number> {
  const events = await db.matchEvents.where('matchId').equals(matchId).sortBy('seq')
  let last = 0
  for (const event of events) {
    if (event.syncState !== 'synced' || event.seq !== last + 1) break
    last = event.seq
  }
  return last
}
