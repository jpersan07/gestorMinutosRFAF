import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  anonClient,
  createMatch,
  createPlayers,
  createTeam,
  createUser,
  expectError,
  must,
  serviceClient,
  type TestTeam,
  type TestUser,
} from './helpers'

const TEAM_TABLES = [
  'teams',
  'seasons',
  'team_members',
  'profiles',
  'players',
  'crests',
  'matches',
  'match_squads',
  'match_events',
  'match_reports',
  'player_match_minutes',
  'client_logs',
  'formation_slots',
] as const

let admin: TestUser // administrador del equipo 1
let coach: TestUser // entrenador del equipo 1
let outsider: TestUser // administrador del equipo 2
let loner: TestUser // cuenta sin equipo
let team1: TestTeam
let team2: TestTeam
let team1Match: string
let team1Players: string[]

beforeAll(async () => {
  ;[admin, coach, outsider, loner] = await Promise.all([
    createUser('Isaac'),
    createUser('Jordi'),
    createUser('Otro'),
    createUser('Solo'),
  ])
  team1 = await createTeam([
    { user: admin, role: 'admin' },
    { user: coach, role: 'coach' },
  ])
  team2 = await createTeam([{ user: outsider, role: 'admin' }], 'Otro equipo')
  team1Players = await createPlayers(admin, team1.teamId, 3)
  team1Match = await createMatch(admin, team1)
  await createPlayers(outsider, team2.teamId, 2)
})

describe('sin sesión (anon)', () => {
  it.each(TEAM_TABLES)('no puede leer %s', async (table) => {
    const result = await anonClient().from(table).select('*').limit(1)
    expectError(result, '42501')
  })

  it('no puede ejecutar append_match_events', async () => {
    const result = await anonClient().rpc('append_match_events', { p_match_id: team1Match, p_events: [] })
    expect(result.error).not.toBeNull()
  })
})

describe('aislamiento entre equipos', () => {
  it('cada usuario solo ve los datos de sus equipos', async () => {
    const own = must(await admin.client.from('players').select('id, team_id'))
    expect(own.data?.every((p) => p.team_id === team1.teamId)).toBe(true)
    expect(own.data).toHaveLength(3)

    const other = must(await outsider.client.from('players').select('id, team_id'))
    expect(other.data?.every((p) => p.team_id === team2.teamId)).toBe(true)

    for (const table of ['teams', 'seasons', 'matches'] as const) {
      const rows = must(await outsider.client.from(table).select('*'))
      expect(JSON.stringify(rows.data)).not.toContain(team1.teamId)
    }
  })

  it('una cuenta sin equipo no ve nada', async () => {
    for (const table of ['teams', 'players', 'matches', 'match_events'] as const) {
      const rows = must(await loner.client.from(table).select('*'))
      expect(rows.data).toEqual([])
    }
  })

  it('no se pueden crear datos en un equipo ajeno', async () => {
    const result = await outsider.client
      .from('players')
      .insert({ id: randomUUID(), team_id: team1.teamId, name: 'Intruso', number: 99 })
    expectError(result, '42501')
  })

  it('no se pueden modificar datos de un equipo ajeno (la fila no es visible)', async () => {
    const result = must(
      await outsider.client.from('matches').update({ opponent: 'Hackeado' }).eq('id', team1Match).select(),
    )
    expect(result.data).toEqual([])
    const check = must(await admin.client.from('matches').select('opponent').eq('id', team1Match).single())
    expect(check.data?.opponent).toBe('Rival')
  })

  it('no se pueden enlazar datos de dos equipos (claves foráneas compuestas)', async () => {
    const result = await admin.client.from('matches').insert({
      id: randomUUID(),
      team_id: team1.teamId,
      season_id: team2.seasonId,
      opponent: 'Cruce',
    })
    expectError(result, '23503')
  })

  it('no se puede enviar eventos a un partido de otro equipo', async () => {
    const result = await outsider.client.rpc('append_match_events', { p_match_id: team1Match, p_events: [] })
    expectError(result, 'MATCH_NOT_FOUND')
  })
})

describe('permisos por columna: el móvil no escribe el estado del partido', () => {
  it('no puede cambiar status ni el controlador', async () => {
    expectError(await admin.client.from('matches').update({ status: 'saved' }).eq('id', team1Match), '42501')
    expectError(
      await admin.client.from('matches').update({ controller_device_id: 'yo' }).eq('id', team1Match),
      '42501',
    )
  })

  it('no puede crear un partido ya empezado', async () => {
    const result = await admin.client.from('matches').insert({
      id: randomUUID(),
      team_id: team1.teamId,
      season_id: team1.seasonId,
      opponent: 'X',
      status: 'first_half',
    })
    expectError(result, '42501')
  })

  it('no puede insertar eventos directamente (solo por append_match_events)', async () => {
    const result = await admin.client.from('match_events').insert({
      id: randomUUID(),
      team_id: team1.teamId,
      match_id: team1Match,
      seq: 1,
      event_type: 'SETUP_STARTED',
      occurred_at: new Date().toISOString(),
      device_id: 'x',
      user_id: admin.id,
    })
    expectError(result, '42501')
  })

  it('no puede mover filas a otro equipo o partido (claves inmutables)', async () => {
    expectError(
      await admin.client.from('players').update({ team_id: team2.teamId }).eq('id', team1Players[0]!),
      'IMMUTABLE_COLUMN',
    )
    const otherMatch = await createMatch(admin, team1, 'Otro')
    expectError(
      await admin.client.from('matches').update({ id: otherMatch }).eq('id', team1Match),
      'IMMUTABLE_COLUMN',
    )
  })

  it('un upsert idempotente (reenvío con los mismos datos) funciona', async () => {
    const [id] = team1Players
    const row = must(await admin.client.from('players').select('id, team_id, name, number, active, created_at').eq('id', id!).single()).data!
    must(await admin.client.from('players').upsert({ ...row, updated_at: new Date().toISOString() }))
  })

  it('no puede fijar el autor de un registro', async () => {
    const result = await admin.client
      .from('players')
      .insert({ id: randomUUID(), team_id: team1.teamId, name: 'X', number: 50, created_by: coach.id })
    expectError(result, '42501')
  })
})

describe('roles', () => {
  it('solo un administrador gestiona los miembros del equipo', async () => {
    const newcomer = await createUser('Nuevo')
    expectError(
      await coach.client.from('team_members').insert({ team_id: team1.teamId, user_id: newcomer.id, role: 'coach' }),
      '42501',
    )
    must(await admin.client.from('team_members').insert({ team_id: team1.teamId, user_id: newcomer.id, role: 'coach' }))
    const promoted = must(
      await coach.client.from('team_members').update({ role: 'admin' }).eq('user_id', coach.id).select(),
    )
    expect(promoted.data).toEqual([])
  })

  it('solo un administrador cambia el nombre del equipo o crea temporadas', async () => {
    const byCoach = must(await coach.client.from('teams').update({ name: 'Cambiado' }).eq('id', team1.teamId).select())
    expect(byCoach.data).toEqual([])
    expectError(
      await coach.client.from('seasons').insert({ id: randomUUID(), team_id: team1.teamId, name: '2027-28' }),
      '42501',
    )
    must(await admin.client.from('seasons').insert({ id: randomUUID(), team_id: team1.teamId, name: '2027-28' }))
  })
})

describe('perfiles', () => {
  it('se crean solos al crear la cuenta', async () => {
    const own = must(await coach.client.from('profiles').select('display_name').eq('id', coach.id).single())
    expect(own.data?.display_name).toBe('Jordi')
  })

  it('se ven los compañeros de equipo, no las cuentas de otros equipos', async () => {
    const visible = must(await coach.client.from('profiles').select('id'))
    const ids = visible.data?.map((r) => r.id) ?? []
    expect(ids).toEqual(expect.arrayContaining([admin.id, coach.id]))
    expect(ids).not.toContain(outsider.id)
    expect(ids).not.toContain(loner.id)
  })

  it('cada uno solo edita su propio perfil', async () => {
    const other = must(await coach.client.from('profiles').update({ display_name: 'X' }).eq('id', admin.id).select())
    expect(other.data).toEqual([])
    must(await coach.client.from('profiles').update({ display_name: 'Jordi P.' }).eq('id', coach.id))
  })
})

describe('registro de errores', () => {
  it('cada entrenador escribe los suyos; solo los administradores los leen', async () => {
    must(await coach.client.from('client_logs').insert({ team_id: team1.teamId, message: 'Error de prueba', device_id: 'd' }))
    expect(must(await coach.client.from('client_logs').select('*')).data).toEqual([])
    const logs = must(await admin.client.from('client_logs').select('message, user_id'))
    expect(logs.data).toContainEqual({ message: 'Error de prueba', user_id: coach.id })
    expectError(
      await outsider.client.from('client_logs').insert({ team_id: team1.teamId, message: 'x' }),
      '42501',
    )
  })
})

describe('las cuentas se crean desde administración', () => {
  it('el registro público está desactivado', async () => {
    const { error } = await anonClient().auth.signUp({ email: `libre-${randomUUID()}@test.local`, password: 'x-password-123' })
    expect(error).not.toBeNull()
  })

  it('el esquema interno no está expuesto por la API', async () => {
    const result = await serviceClient().schema('private' as 'public').from('match_states' as 'teams').select('*')
    expect(result.error).not.toBeNull()
  })
})
