import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import type { MatchEvent } from '../../src/domain'
import { MatchHarness, lineupOf } from '../../src/domain/__tests__/harness'
import type { Database, Json } from '../../src/data/remote/database.types'
import { toRemoteEvent, type RemoteEventInput } from '../../src/data/remote/eventMapping'

// Claves del Supabase LOCAL. La clave de servicio solo se usa aquí, en tests de Node,
// para preparar datos (crear usuarios y equipos). Nunca llega a la app.
interface LocalEnv {
  readonly url: string
  readonly anonKey: string
  readonly serviceKey: string
  /** Conexión directa a la base de datos LOCAL (credenciales por defecto del Supabase local). */
  readonly dbUrl: string
}

function readLocalEnv(): LocalEnv {
  const raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string | undefined>
  const url = status.API_URL
  const anonKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY
  const dbUrl = status.DB_URL
  if (!url || !anonKey || !serviceKey || !dbUrl) throw new Error('Supabase local no está en marcha: npm run db:start')
  return { url, anonKey, serviceKey, dbUrl }
}

export const env = readLocalEnv()

export type Client = SupabaseClient<Database>

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

export const serviceClient = (): Client => createClient<Database>(env.url, env.serviceKey, noSession)
export const anonClient = (): Client => createClient<Database>(env.url, env.anonKey, noSession)

const runId = randomUUID().slice(0, 8)
let counter = 0

export interface TestUser {
  readonly id: string
  readonly email: string
  readonly client: Client
}

/** Crea una cuenta de entrenador (como haría un administrador) y abre su sesión. */
export async function createUser(displayName: string): Promise<TestUser> {
  const email = `${displayName.toLowerCase()}-${runId}-${++counter}@test.local`
  const password = 'test-password-1234'
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  })
  if (error || !data.user) throw error ?? new Error('Sin usuario')
  const client = createClient<Database>(env.url, env.anonKey, noSession)
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { id: data.user.id, email, client }
}

/** Falla el test si la operación devolvió error. */
export function must<T extends { error: PostgrestError | null }>(result: T): T {
  if (result.error) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result
}

/** Espera un error de Postgres/PostgREST con ese código o mensaje. */
export function expectError(result: { error: PostgrestError | null }, match: string | RegExp) {
  expect(result.error, 'se esperaba un error').not.toBeNull()
  const text = `${result.error?.code} ${result.error?.message}`
  if (typeof match === 'string') expect(text).toContain(match)
  else expect(text).toMatch(match)
}

export interface TestTeam {
  readonly teamId: string
  readonly seasonId: string
}

/** Equipo con temporada actual y miembros (lo prepara el administrador del sistema). */
export async function createTeam(
  members: ReadonlyArray<{ user: TestUser; role: 'admin' | 'coach' }>,
  name = `Equipo test ${runId}`,
): Promise<TestTeam> {
  const admin = serviceClient()
  const teamId = randomUUID()
  const seasonId = randomUUID()
  must(await admin.from('teams').insert({ id: teamId, name }))
  must(await admin.from('seasons').insert({ id: seasonId, team_id: teamId, name: '2026-27' }))
  must(await admin.from('teams').update({ current_season_id: seasonId }).eq('id', teamId))
  if (members.length > 0) {
    must(
      await admin
        .from('team_members')
        .insert(members.map((m) => ({ team_id: teamId, user_id: m.user.id, role: m.role }))),
    )
  }
  return { teamId, seasonId }
}

export async function createPlayers(user: TestUser, teamId: string, count: number, firstNumber = 1): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    team_id: teamId,
    name: `Jugador ${firstNumber + i}`,
    number: firstNumber + i,
  }))
  must(await user.client.from('players').insert(rows))
  return rows.map((r) => r.id)
}

export async function createMatch(user: TestUser, team: TestTeam, opponent = 'Rival'): Promise<string> {
  const id = randomUUID()
  must(await user.client.from('matches').insert({ id, team_id: team.teamId, season_id: team.seasonId, opponent }))
  return id
}

export interface AppendResult {
  readonly accepted: string[]
  readonly duplicates: string[]
  readonly rejected: { id: string; seq: number; reason: string } | null
  readonly match: { status: string; last_seq: number; controller_device_id: string | null; control_epoch: number }
}

/** Envía eventos (ya en formato remoto) por la única puerta de entrada. */
export async function appendRaw(user: TestUser, matchId: string, events: readonly RemoteEventInput[]) {
  return user.client.rpc('append_match_events', {
    p_match_id: matchId,
    p_events: events as unknown as Json,
  })
}

/** TOMAR CONTROL atómico: solo si el control_epoch del servidor sigue siendo `expectedEpoch`. */
export async function takeControlRaw(user: TestUser, matchId: string, expectedEpoch: number, event: RemoteEventInput) {
  return user.client.rpc('take_match_control', {
    p_match_id: matchId,
    p_expected_control_epoch: expectedEpoch,
    p_event: event as unknown as Json,
  })
}

export async function append(user: TestUser, matchId: string, events: readonly MatchEvent[]): Promise<AppendResult> {
  const { data, error } = await appendRaw(user, matchId, events.map(toRemoteEvent))
  if (error) throw new Error(`${error.code}: ${error.message}`)
  return data as unknown as AppendResult
}

/**
 * Escenario completo: entrenador admin, equipo, 16 jugadores (14 convocados), partido con
 * convocatoria guardada y un "móvil" (MatchHarness del dominio) que genera los eventos reales.
 */
export async function matchScenario() {
  const coach = await createUser('Isaac')
  const team = await createTeam([{ user: coach, role: 'admin' }])
  const playerIds = await createPlayers(coach, team.teamId, 16)
  const squad = playerIds.slice(0, 14)
  const matchId = await createMatch(coach, team)
  must(await coach.client.from('match_squads').insert({ match_id: matchId, team_id: team.teamId, player_ids: squad }))

  const device = new MatchHarness(matchId, randomUUID)
  device.squad = [...squad]
  device.deviceId = `device-${randomUUID().slice(0, 8)}`
  const lineup = lineupOf('4-3-3', squad.slice(0, 11))

  let pushed = 0
  /** Envía al servidor los eventos del móvil que aún no se han enviado. */
  const sync = async (as: TestUser = coach) => {
    const pending = device.events.slice(pushed)
    const result = await append(as, matchId, pending)
    pushed += result.accepted.length + result.duplicates.length
    return result
  }

  return { coach, team, playerIds, squad, matchId, device, lineup, sync }
}

export const p = (ids: readonly string[], n: number) => {
  const id = ids[n - 1]
  if (!id) throw new Error(`No hay jugador ${n}`)
  return id
}
