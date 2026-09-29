import { describe, expect, it } from 'vitest'
import {
  applyTeamContext,
  createMatch,
  createPlayer,
  discardReasonFor,
  getDeviceId,
  getLocalAccount,
  localScopeFor,
  summarizeLocalData,
  wipeLocalData,
  type LocalAccount,
} from '..'
import { openTestDb, reopen, TEST_TEAM_CONTEXT, TestEnv } from './testDb'

const EMPTY = { players: 0, matches: 0, events: 0 }
const SOME = { players: 12, matches: 3, events: 0 }
const unbound: LocalAccount = { userId: null, teamId: null, seasonId: null }
const bound: LocalAccount = { userId: 'user-isaac', teamId: 'team-1', seasonId: 'season-1' }

describe('¿hay que borrar los datos locales al entrar en un equipo?', () => {
  it('sin datos locales, nunca', () => {
    expect(discardReasonFor(unbound, EMPTY, 'team-1')).toBeNull()
    expect(discardReasonFor(bound, EMPTY, 'team-2')).toBeNull()
  })

  it('datos sin vincular a ningún equipo (pruebas de la Fase 2) → test-data', () => {
    expect(discardReasonFor(unbound, SOME, 'team-1')).toBe('test-data')
    expect(discardReasonFor(unbound, { players: 0, matches: 0, events: 4 }, 'team-1')).toBe('test-data')
  })

  it('datos de otro equipo → other-team', () => {
    expect(discardReasonFor(bound, SOME, 'team-2')).toBe('other-team')
  })

  it('datos del mismo equipo (misma u otra cuenta) → se conservan', () => {
    expect(discardReasonFor(bound, SOME, 'team-1')).toBeNull()
    expect(discardReasonFor({ ...bound, userId: 'user-jordi' }, SOME, 'team-1')).toBeNull()
  })
})

describe('cuenta y equipo en el dispositivo', () => {
  it('el identificador del dispositivo se crea una vez y se mantiene', async () => {
    const db = openTestDb()
    const env = new TestEnv()
    const first = await getDeviceId(db, env)
    expect(await getDeviceId(reopen(db), env)).toBe(first)
  })

  it('aplicar el contexto del servidor guarda equipo, temporada, perfiles y vinculación', async () => {
    const db = openTestDb()
    const env = new TestEnv()
    const deviceId = await getDeviceId(db, env)
    const scope = await applyTeamContext(db, env, 'user-jordi', TEST_TEAM_CONTEXT)
    expect(scope).toEqual({ deviceId, userId: 'user-jordi', teamId: 'team-1', seasonId: 'season-1' })
    expect(await db.teams.get('team-1')).toMatchObject({ name: 'Equipo de prueba', currentSeasonId: 'season-1' })
    expect(await db.seasons.get('season-1')).toMatchObject({ teamId: 'team-1', name: '2026-27' })
    expect((await db.profiles.toArray()).map((p) => p.displayName).sort()).toEqual(['ISAAC', 'JORDI'])
    expect(await db.teamMembers.count()).toBe(2)
    expect(await getLocalAccount(db)).toEqual({ userId: 'user-jordi', teamId: 'team-1', seasonId: 'season-1' })
  })

  it('volver a aplicarlo actualiza los miembros (bajas incluidas) sin duplicar', async () => {
    const db = openTestDb()
    const env = new TestEnv()
    await applyTeamContext(db, env, 'user-isaac', TEST_TEAM_CONTEXT)
    await applyTeamContext(db, env, 'user-isaac', { ...TEST_TEAM_CONTEXT, members: [TEST_TEAM_CONTEXT.members[0]!] })
    expect((await db.teamMembers.toArray()).map((m) => m.userId)).toEqual(['user-isaac'])
  })

  it('el ámbito local permite arrancar sin conexión, solo para la cuenta vinculada', async () => {
    const db = openTestDb()
    const env = new TestEnv()
    const deviceId = await getDeviceId(db, env)
    await applyTeamContext(db, env, 'user-isaac', TEST_TEAM_CONTEXT)
    const again = reopen(db)
    expect(await localScopeFor(again, deviceId, 'user-isaac')).toEqual({
      deviceId,
      userId: 'user-isaac',
      teamId: 'team-1',
      seasonId: 'season-1',
    })
    expect(await localScopeFor(again, deviceId, 'user-jordi')).toBeNull()
  })

  it('borrar los datos locales conserva solo el identificador del dispositivo', async () => {
    const db = openTestDb()
    const env = new TestEnv()
    const deviceId = await getDeviceId(db, env)
    const scope = await applyTeamContext(db, env, 'user-isaac', TEST_TEAM_CONTEXT)
    await createPlayer(db, env, scope.teamId, { name: 'Jugador', number: 7 })
    await createMatch(db, env, scope, { opponent: 'Rival', matchDate: null, kickoffTime: null, location: null })
    expect(await summarizeLocalData(db)).toEqual({ players: 1, matches: 1, events: 0 })

    await wipeLocalData(db)
    expect(await summarizeLocalData(db)).toEqual(EMPTY)
    expect(await db.teams.count()).toBe(0)
    expect(await getLocalAccount(db)).toEqual(unbound)
    expect(await getDeviceId(db, env)).toBe(deviceId)
  })
})

describe('actualización de la base de datos del móvil (v1 de la Fase 2 → v2)', () => {
  it('conserva los datos existentes, elimina "coaches" y añade perfiles y miembros', async () => {
    const { default: Dexie } = await import('dexie')
    const { AppDatabase } = await import('../db')
    const name = `upgrade-${Math.random()}`

    // Base de datos tal como la dejaba la Fase 2 (esquema v1).
    const v1 = new Dexie(name)
    v1.version(1).stores({
      meta: 'key',
      teams: 'id',
      seasons: 'id, teamId',
      coaches: 'id, teamId',
      players: 'id, teamId',
      matches: 'id, teamId, seasonId, status',
      matchSquads: 'matchId',
      matchEvents: 'id, matchId, &[matchId+seq]',
      lineupDrafts: '[matchId+half]',
      matchReports: 'matchId',
      playerMatchMinutes: '[matchId+playerId], matchId, playerId',
      crests: 'id',
      errorLog: '++id, createdAt',
    })
    await v1.table('meta').put({ key: 'deviceId', value: 'device-fase2' })
    await v1.table('coaches').put({ id: 'c1', teamId: 't-local', name: 'ISAAC' })
    await v1.table('players').put({ id: 'p1', teamId: 't-local', name: 'Prueba', number: 7, active: true })
    v1.close()

    const v2 = new AppDatabase(name)
    expect(v2.tables.map((t) => t.name)).not.toContain('coaches')
    expect(await v2.players.count()).toBe(1)
    expect(await v2.profiles.count()).toBe(0)
    expect(await getDeviceId(v2, new TestEnv())).toBe('device-fase2')
    // Datos de la Fase 2 sin vincular a ninguna cuenta → al iniciar sesión se ofrecerá borrarlos.
    expect(discardReasonFor(await getLocalAccount(v2), await summarizeLocalData(v2), 'team-real')).toBe('test-data')
    v2.close()
    await v2.delete()
  })
})
