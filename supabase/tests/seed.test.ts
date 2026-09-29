import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { Database } from '../../src/data/remote/database.types'
import { env, must } from './helpers'

// Comprueba el seed de desarrollo local (supabase/seed.sql): cuentas DEMO que pueden
// iniciar sesión y ven solo su equipo DEMO.
describe('seed de desarrollo local', () => {
  it('ISAAC DEMO inicia sesión y es administrador del Equipo DEMO, sin ver el otro equipo', async () => {
    const client = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.signInWithPassword({
      email: 'isaac.demo@demo.local',
      password: 'demo-local-2026',
    })
    expect(error).toBeNull()
    const teams = must(await client.from('teams').select('name, current_season_id'))
    expect(teams.data?.map((t) => t.name)).toEqual(['Equipo DEMO'])
    expect(teams.data?.[0]?.current_season_id).toBeTruthy()
    const membership = must(await client.from('team_members').select('role').eq('user_id', data.user!.id).single())
    expect(membership.data?.role).toBe('admin')
    const members = must(await client.from('profiles').select('display_name'))
    expect(members.data?.map((m) => m.display_name).sort()).toEqual(['ISAAC DEMO', 'JORDI DEMO', 'JOSÉ DEMO'])
  })
})
