import type { EpochMs, Id } from '../../domain'
import type {
  CrestRecord,
  ErrorLogRecord,
  MatchRecord,
  MatchReportRecord,
  MatchSquadRecord,
  PlayerMatchMinutesRecord,
  PlayerRecord,
} from '../db'
import type { Database, Json } from '../remote/database.types'

// Conversión de registros locales → filas del servidor. Funciones puras.

type Insert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']

const iso = (ms: EpochMs) => new Date(ms).toISOString()

export function playerRow(player: PlayerRecord): Insert<'players'> {
  return {
    id: player.id,
    team_id: player.teamId,
    name: player.name,
    number: player.number,
    active: player.active,
    created_at: iso(player.createdAt),
    updated_at: iso(player.updatedAt),
  }
}

/**
 * Solo los datos editables. NUNCA el estado, el controlador ni el guardado: eso lo deriva el
 * servidor de los eventos. updated_at = última edición de estos datos (no la de los eventos).
 */
export function matchRow(match: MatchRecord): Insert<'matches'> {
  return {
    id: match.id,
    team_id: match.teamId,
    season_id: match.seasonId,
    opponent: match.opponent,
    crest_id: match.crestId,
    match_date: match.matchDate,
    kickoff_time: match.kickoffTime,
    location: match.location,
    created_at: iso(match.createdAt),
    updated_at: iso(match.detailsUpdatedAt ?? match.createdAt),
  }
}

export function squadRow(squad: MatchSquadRecord, teamId: Id): Insert<'match_squads'> {
  return {
    match_id: squad.matchId,
    team_id: teamId,
    player_ids: [...squad.playerIds],
    updated_at: iso(squad.updatedAt),
  }
}

export function reportRow(report: MatchReportRecord, teamId: Id): Insert<'match_reports'> {
  return {
    match_id: report.matchId,
    team_id: teamId,
    result: report.result,
    observations: report.observations,
    updated_at: iso(report.updatedAt),
  }
}

export function minutesRow(row: PlayerMatchMinutesRecord, teamId: Id, now: EpochMs): Insert<'player_match_minutes'> {
  return {
    match_id: row.matchId,
    player_id: row.playerId,
    team_id: teamId,
    seconds_played: row.secondsPlayed,
    minutes_played: row.minutesPlayed,
    started: row.started,
    updated_at: iso(now),
  }
}

const EXTENSIONS: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }

export interface CrestUpload {
  /** Ruta en el bucket privado "crests": <team_id>/<crest_id>.<ext>. */
  readonly path: string
  readonly contentType: string
  readonly bytes: Uint8Array
  readonly row: Insert<'crests'>
}

/** El escudo local es un data URL; en el servidor, la imagen va a Storage y la fila guarda la ruta. */
export function crestUpload(crest: CrestRecord, teamId: Id): CrestUpload | null {
  const match = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(crest.dataUrl)
  if (!match) return null
  const contentType = match[1]!
  const binary = atob(match[2]!)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const path = `${teamId}/${crest.id}.${EXTENSIONS[contentType]}`
  return {
    path,
    contentType,
    bytes,
    row: {
      id: crest.id,
      team_id: teamId,
      storage_path: path,
      mime_type: contentType,
      size_bytes: bytes.length,
      created_at: iso(crest.createdAt),
    },
  }
}

export function errorLogRow(entry: ErrorLogRecord, teamId: Id, deviceId: string): Insert<'client_logs'> {
  return {
    team_id: teamId,
    device_id: deviceId,
    level: 'error',
    message: entry.message.slice(0, 2000),
    context: (entry.context ?? null) as Json,
    created_at: iso(entry.createdAt),
  }
}
