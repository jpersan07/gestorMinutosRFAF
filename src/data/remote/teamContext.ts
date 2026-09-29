import type { Id } from '../../domain'
import type { TeamRole } from '../db'
import type { Supabase } from './client'

/** Equipo al que pertenece la cuenta (para elegir si hay varios). */
export interface Membership {
  readonly teamId: Id
  readonly teamName: string
  readonly role: TeamRole
}

/** Lo que la app necesita del servidor para funcionar en un equipo. */
export interface TeamContext {
  readonly team: { readonly id: Id; readonly name: string; readonly currentSeasonId: Id | null }
  /** Temporada activa del equipo (null si el administrador no la ha configurado). */
  readonly season: { readonly id: Id; readonly name: string } | null
  readonly members: ReadonlyArray<{ readonly userId: Id; readonly displayName: string; readonly role: TeamRole }>
}

export async function loadMemberships(supabase: Supabase, userId: Id): Promise<Membership[]> {
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams ( name )')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? [])
    .map((row) => ({ teamId: row.team_id, teamName: row.teams?.name ?? '', role: row.role }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName, 'es'))
}

export async function loadTeamContext(supabase: Supabase, teamId: Id): Promise<TeamContext> {
  const team = await supabase.from('teams').select('id, name, current_season_id').eq('id', teamId).single()
  if (team.error) throw team.error

  const seasonId = team.data.current_season_id
  const season = seasonId
    ? await supabase.from('seasons').select('id, name').eq('id', seasonId).single()
    : null
  if (season?.error) throw season.error

  const members = await supabase
    .from('team_members')
    .select('user_id, role, profiles ( display_name )')
    .eq('team_id', teamId)
  if (members.error) throw members.error

  return {
    team: { id: team.data.id, name: team.data.name, currentSeasonId: seasonId },
    season: season?.data ? { id: season.data.id, name: season.data.name } : null,
    members: members.data.map((m) => ({
      userId: m.user_id,
      displayName: m.profiles?.display_name ?? '',
      role: m.role,
    })),
  }
}
