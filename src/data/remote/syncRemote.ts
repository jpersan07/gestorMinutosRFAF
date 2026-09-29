import type { EpochMs, Id } from '../../domain'
import type { TeamRole } from '../db'
import type { Supabase } from './client'
import type { Database, Json } from './database.types'
import type { RemoteEventInput, RemoteEventRow } from './eventMapping'

// Lecturas del servidor que necesita la descarga (3d) y la llamada de TOMAR CONTROL.
// Es una interfaz para poder probar la fusión y TOMAR CONTROL con un servidor simulado;
// la implementación real (supabaseRemote) solo traduce a consultas de Supabase. Todo pasa
// por RLS con la sesión del entrenador: nunca se ven datos de otros equipos.

type Tables = Database['public']['Tables']
export type ServerRow<T extends keyof Tables> = Tables[T]['Row']

/** Tablas de datos editables ("gana el último") que se descargan por cursor de servidor. */
export type EditableTable = 'players' | 'matches' | 'match_squads' | 'match_reports' | 'player_match_minutes'

/** Respuesta de append_match_events / take_match_control. */
export interface AppendResult {
  readonly accepted: readonly Id[]
  readonly duplicates: readonly Id[]
  readonly rejected: { readonly id: Id; readonly seq: number; readonly reason: string } | null
  readonly match?: {
    readonly status: string
    readonly last_seq: number
    readonly controller_device_id: string | null
    readonly control_epoch: number
  }
}

export interface TeamSnapshot {
  readonly team: { readonly id: Id; readonly name: string; readonly currentSeasonId: Id | null }
  readonly seasons: ReadonlyArray<{ readonly id: Id; readonly name: string }>
  readonly members: ReadonlyArray<{ readonly userId: Id; readonly displayName: string; readonly role: TeamRole }>
}

export interface MatchData {
  readonly squad: ServerRow<'match_squads'> | null
  readonly report: ServerRow<'match_reports'> | null
  readonly minutes: ReadonlyArray<ServerRow<'player_match_minutes'>>
}

export interface SyncRemote {
  teamSnapshot(teamId: Id): Promise<TeamSnapshot>
  /** Filas con synced_at (hora del SERVIDOR) posterior a `since`, en orden de synced_at. */
  changedSince<T extends EditableTable>(table: T, teamId: Id, since: string | null): Promise<Array<ServerRow<T>>>
  match(matchId: Id): Promise<ServerRow<'matches'> | null>
  /** Eventos del partido con seq > afterSeq, en orden de seq. */
  matchEventsAfter(matchId: Id, afterSeq: number): Promise<RemoteEventRow[]>
  matchData(matchId: Id): Promise<MatchData>
  crests(ids: readonly Id[]): Promise<Array<ServerRow<'crests'>>>
  crestImage(path: string): Promise<Blob>
  takeControl(matchId: Id, expectedControlEpoch: number, event: RemoteEventInput): Promise<AppendResult>
  serverTime(): Promise<EpochMs>
}

const PAGE = 1000

/** Clave de cada tabla: desempata el orden para que las páginas no se solapen ni salten filas. */
const KEYS: Record<EditableTable, readonly string[]> = {
  players: ['id'],
  matches: ['id'],
  match_squads: ['match_id'],
  match_reports: ['match_id'],
  player_match_minutes: ['match_id', 'player_id'],
}

function fail(error: { message: string; code?: string }): never {
  throw Object.assign(new Error(error.message), { code: error.code })
}

export function supabaseRemote(supabase: Supabase): SyncRemote {
  return {
    async teamSnapshot(teamId) {
      const [team, seasons, members] = await Promise.all([
        supabase.from('teams').select('id, name, current_season_id').eq('id', teamId).single(),
        supabase.from('seasons').select('id, name').eq('team_id', teamId),
        supabase.from('team_members').select('user_id, role, profiles ( display_name )').eq('team_id', teamId),
      ])
      if (team.error) fail(team.error)
      if (seasons.error) fail(seasons.error)
      if (members.error) fail(members.error)
      return {
        team: { id: team.data.id, name: team.data.name, currentSeasonId: team.data.current_season_id },
        seasons: seasons.data,
        members: members.data.map((m) => ({
          userId: m.user_id,
          displayName: m.profiles?.display_name ?? '',
          role: m.role,
        })),
      }
    },

    async changedSince(table, teamId, since) {
      const rows: Array<ServerRow<typeof table>> = []
      for (let from = 0; ; from += PAGE) {
        // Cast: los genéricos de supabase-js no se resuelven con un nombre de tabla genérico.
        let query = supabase.from(table as 'players').select('*').eq('team_id', teamId)
        if (since) query = query.gt('synced_at', since)
        query = query.order('synced_at', { ascending: true })
        for (const key of KEYS[table]) query = query.order(key as 'id', { ascending: true })
        const { data, error } = await query.range(from, from + PAGE - 1)
        if (error) fail(error)
        rows.push(...(data as unknown as Array<ServerRow<typeof table>>))
        if (data.length < PAGE) return rows as never
      }
    },

    async match(matchId) {
      const { data, error } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle()
      if (error) fail(error)
      return data
    },

    async matchEventsAfter(matchId, afterSeq) {
      const events: RemoteEventRow[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('match_events')
          .select('*')
          .eq('match_id', matchId)
          .gt('seq', afterSeq)
          .order('seq', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) fail(error)
        events.push(...(data as unknown as RemoteEventRow[]))
        if (data.length < PAGE) return events
      }
    },

    async matchData(matchId) {
      const [squad, report, minutes] = await Promise.all([
        supabase.from('match_squads').select('*').eq('match_id', matchId).maybeSingle(),
        supabase.from('match_reports').select('*').eq('match_id', matchId).maybeSingle(),
        supabase.from('player_match_minutes').select('*').eq('match_id', matchId),
      ])
      if (squad.error) fail(squad.error)
      if (report.error) fail(report.error)
      if (minutes.error) fail(minutes.error)
      return { squad: squad.data, report: report.data, minutes: minutes.data }
    },

    async crests(ids) {
      if (ids.length === 0) return []
      const { data, error } = await supabase.from('crests').select('*').in('id', [...ids])
      if (error) fail(error)
      return data
    },

    async crestImage(path) {
      const { data, error } = await supabase.storage.from('crests').download(path)
      if (error) fail(error)
      return data
    },

    async takeControl(matchId, expectedControlEpoch, event) {
      const { data, error } = await supabase.rpc('take_match_control', {
        p_match_id: matchId,
        p_expected_control_epoch: expectedControlEpoch,
        p_event: event as unknown as Json,
      })
      if (error) fail(error)
      return data as unknown as AppendResult
    },

    async serverTime() {
      const { data, error } = await supabase.rpc('server_time')
      if (error) fail(error)
      return Number(data)
    },
  }
}
