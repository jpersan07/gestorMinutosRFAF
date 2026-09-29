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
