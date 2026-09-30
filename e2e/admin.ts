// Utilidades de administración SOLO para los tests E2E (Node), contra el Supabase LOCAL.
// La clave de servicio se lee de `supabase status` en tiempo de ejecución y nunca llega a la app.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string | undefined>
const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY ?? ''
const mailpitUrl = status.MAILPIT_URL ?? status.INBUCKET_URL ?? 'http://127.0.0.1:54324'
const admin = createClient(status.API_URL ?? '', serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

/** Equipo DEMO del seed local. */
export const DEMO_TEAM_ID = '00000000-0000-4000-8000-0000000d0001'

export interface TestCoach {
  readonly id: string
  readonly email: string
  readonly password: string
  readonly displayName: string
}

/** Crea una cuenta de entrenador (como haría el administrador), opcionalmente en el equipo DEMO. */
export async function createCoach(options: { inDemoTeam: boolean }): Promise<TestCoach> {
  const suffix = randomUUID().slice(0, 8)
  const coach = {
    email: `e2e-${suffix}@test.local`,
    password: 'e2e-password-123',
    displayName: `E2E ${suffix.toUpperCase()}`,
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: coach.email,
    password: coach.password,
    email_confirm: true,
    user_metadata: { display_name: coach.displayName },
  })
  if (error || !data.user) throw error ?? new Error('Sin usuario')
  if (options.inDemoTeam) {
    const member = await admin.from('team_members').insert({ team_id: DEMO_TEAM_ID, user_id: data.user.id, role: 'coach' })
    if (member.error) throw member.error
  }
  return { id: data.user.id, ...coach }
}

/** Enlace del último correo de recuperación recibido en Mailpit para ese email. */
export async function recoveryLinkFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = (await (await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as {
      messages?: Array<{ ID: string }>
    }
    const id = search.messages?.[0]?.ID
    if (id) {
      const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as { HTML: string }
      const href = /href="([^"]*\/restablecer\?[^"]*)"/.exec(message.HTML)?.[1]
      if (href) return href.replaceAll('&amp;', '&')
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No ha llegado el correo de recuperación a ${email}`)
}

export async function countEmailsTo(email: string): Promise<number> {
  const search = (await (await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as {
    messages_count?: number
  }
  return search.messages_count ?? 0
}

/** Cuenta de entrenador con SU PROPIO equipo y temporada activa: cada test trabaja aislado. */
export async function createCoachWithOwnTeam(
  options: { readonly teamName?: string } = {},
): Promise<TestCoach & { readonly teamId: string; readonly teamName: string }> {
  const coach = await createCoach({ inDemoTeam: false })
  const teamId = randomUUID()
  const seasonId = randomUUID()
  const teamName = options.teamName ?? `Equipo ${coach.displayName}`
  const steps = [
    await admin.from('teams').insert({ id: teamId, name: teamName }),
    await admin.from('seasons').insert({ id: seasonId, team_id: teamId, name: '2026-27' }),
    await admin.from('teams').update({ current_season_id: seasonId }).eq('id', teamId),
    await admin.from('team_members').insert({ team_id: teamId, user_id: coach.id, role: 'admin' }),
  ]
  const failed = steps.find((step) => step.error)
  if (failed?.error) throw failed.error
  return { ...coach, teamId, teamName }
}

/** Cliente de servicio para comprobar en los tests qué ha llegado al servidor. */
export const serverAdmin = admin

/** Eventos del partido tal como están en el SERVIDOR. */
export async function serverEvents(matchId: string) {
  const { data, error } = await admin
    .from('match_events')
    .select('seq, event_type, device_id')
    .eq('match_id', matchId)
    .order('seq')
  if (error) throw error
  return data
}

export async function serverPlayers(teamId: string) {
  const { data, error } = await admin.from('players').select('name, number').eq('team_id', teamId)
  if (error) throw error
  return data
}

export async function serverMatches(teamId: string) {
  const { data, error } = await admin.from('matches').select('id, opponent, status').eq('team_id', teamId)
  if (error) throw error
  return data
}

/** Añade un entrenador NUEVO al equipo (otra cuenta, otro móvil). */
export async function addCoachToTeam(teamId: string): Promise<TestCoach> {
  const other = await createCoach({ inDemoTeam: false })
  const member = await admin.from('team_members').insert({ team_id: teamId, user_id: other.id, role: 'coach' })
  if (member.error) throw member.error
  return other
}

/**
 * "Móvil B": otro entrenador del mismo equipo TOMA EL CONTROL del partido en el servidor, como
 * lo haría su app: take_match_control con el control_epoch y el seq que ha descargado.
 */
export async function takeControlFromAnotherPhone(teamId: string, matchId: string) {
  const other = await addCoachToTeam(teamId)
  const client = createClient(status.API_URL ?? '', status.PUBLISHABLE_KEY ?? status.ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signIn = await client.auth.signInWithPassword({ email: other.email, password: other.password })
  if (signIn.error) throw signIn.error
  const match = await client.from('matches').select('last_seq, control_epoch').eq('id', matchId).single()
  if (match.error) throw match.error
  const { data, error } = await client.rpc('take_match_control', {
    p_match_id: matchId,
    p_expected_control_epoch: match.data.control_epoch,
    p_event: {
      id: randomUUID(),
      seq: match.data.last_seq + 1,
      type: 'CONTROL_TAKEN',
      occurred_at: Date.now(),
      device_id: 'movil-B',
      payload: {},
    },
  })
  if (error) throw error
  if ((data as { rejected: unknown }).rejected) throw new Error(`B no pudo tomar el control: ${JSON.stringify(data)}`)
}
