import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  advanceMatch,
  AppDatabase,
  applyTeamContext,
  countPending,
  createMatch as createLocalMatch,
  createPlayer,
  getDeviceId,
  listMatchEvents,
  loadMatchState,
  loadTeamContext,
  logError,
  pushOnce,
  runMatchCommand,
  saveMatch,
  saveReport,
  saveSquad,
  updateMatchDetails,
  updatePlayer,
  type Actor,
  type Supabase,
} from '../../src/data'
import { lineupOnField, type MatchCommand } from '../../src/domain'
import { lineupOf } from '../../src/domain/__tests__/harness'
import type { Database } from '../../src/data/remote/database.types'
import { toRemoteEvent } from '../../src/data/remote/eventMapping'
import { appendRaw, createTeam, createUser, env, must, serviceClient, type TestTeam, type TestUser } from './helpers'

const crestDataUrl = `data:image/png;base64,${readFileSync('public/pwa-64x64.png').toString('base64')}`

/** Un "móvil": su propia base de datos local, la cuenta del entrenador y su reloj. */
async function phone(user: TestUser, team: TestTeam) {
  const db = new AppDatabase(`phone-${randomUUID()}`)
  const clock = { time: Date.now() }
  const dataEnv = { now: () => clock.time, newId: () => randomUUID() }
  await getDeviceId(db, dataEnv)
  const context = await loadTeamContext(user.client, team.teamId)
  const scope = await applyTeamContext(db, dataEnv, user.id, { ...context, season: context.season! })
  const actor: Actor = { deviceId: scope.deviceId, coachId: user.id }
  const run = async (matchId: string, command: MatchCommand) => {
    const result = await runMatchCommand(db, dataEnv, matchId, command, actor)
    if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
    return result.value
  }
  return {
    db,
    env: dataEnv,
    clock,
    scope,
    actor,
    run,
    wait: (seconds: number) => {
      clock.time += seconds * 1000
    },
    push: (supabase: Supabase = user.client) => pushOnce({ db, supabase, scope }),
  }
}
type Phone = Awaited<ReturnType<typeof phone>>

async function addPlayers(device: Phone, count: number, first = 1) {
  const ids: string[] = []
  for (let n = first; n < first + count; n++) {
    const result = await createPlayer(device.db, device.env, device.scope.teamId, { name: `Jugador ${n}`, number: n })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    ids.push(result.value.id)
  }
  return ids
}

async function newMatch(device: Phone, playerIds: string[], crest?: string) {
  const match = await createLocalMatch(device.db, device.env, device.scope, {
    opponent: 'CD Málaga',
    matchDate: '2026-10-10',
    kickoffTime: '18:00',
    location: 'Campo Municipal',
    crest,
  })
  if (!match.ok) throw new Error(JSON.stringify(match.error))
  await saveSquad(device.db, device.env, match.value.id, playerIds, device.scope.userId)
  return match.value.id
}

async function kickOff(device: Phone, matchId: string, playerIds: string[]) {
  await device.run(matchId, { type: 'START_SETUP' })
  await device.run(matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', playerIds.slice(0, 11)) })
  await device.run(matchId, { type: 'START_MATCH' })
}

async function coachWithTeam() {
  const coach = await createUser('Isaac')
  const team = await createTeam([{ user: coach, role: 'admin' }])
  return { coach, team, device: await phone(coach, team) }
}

async function serverCount(table: 'players' | 'match_events' | 'player_match_minutes', column: string, value: string) {
  const { count } = await serviceClient().from(table).select('*', { count: 'exact', head: true }).eq(column, value)
  return count ?? 0
}

describe('subida completa (orden: jugadores → escudo → partido → convocatoria → eventos → informe/minutos → errores)', () => {
  it('todo termina en el servidor, en orden, y el móvil queda sin pendientes', async () => {
    const { coach, team, device } = await coachWithTeam()
    const players = await addPlayers(device, 14)
    const matchId = await newMatch(device, players, crestDataUrl)
    await kickOff(device, matchId, players)
    device.wait(20 * 60)
    await device.run(matchId, { type: 'SUBSTITUTE', outPlayerId: players[9]!, inPlayerId: players[11]! })
    device.wait(30 * 60)
    await advanceMatch(device.db, device.env, matchId, device.actor)
    const state = await loadMatchState(device.db, matchId)
    await device.run(matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(state)! })
    device.wait(15)
    await device.run(matchId, { type: 'START_SECOND_HALF' })
    device.wait(46 * 60)
    await advanceMatch(device.db, device.env, matchId, device.actor)
    await saveReport(device.db, device.env, matchId, { result: '2-1', observations: 'Test de subida' }, coach.id)
    const saved = await saveMatch(device.db, device.env, matchId, device.actor)
    expect(saved.ok).toBe(true)
    await logError(device.db, new Error('Error técnico de prueba'), { at: 'test' })

    // El informe se sube DESPUÉS de los eventos: el servidor pide el RESULTADO antes de aceptar
    // MATCH_SAVED (RESULT_REQUIRED) y el motor sube el informe y reintenta en la misma pasada.
    const report = await device.push()
    expect(report).toMatchObject({ ok: true, newConflicts: 0, controlLost: [], quarantined: 0 })
    expect(await countPending(device.db)).toBe(0)
    expect(await device.db.errorLog.count()).toBe(0)

    const server = coach.client
    expect(await serverCount('players', 'team_id', team.teamId)).toBe(14)
    const match = must(await server.from('matches').select('*').eq('id', matchId).single()).data!
    expect(match).toMatchObject({ status: 'saved', opponent: 'CD Málaga', location: 'Campo Municipal', controller_device_id: device.scope.deviceId })
    const crest = must(await server.from('crests').select('storage_path, mime_type').eq('id', match.crest_id!).single()).data!
    expect(crest.mime_type).toBe('image/png')
    expect((await server.storage.from('crests').download(crest.storage_path)).error).toBeNull()
    const squad = must(await server.from('match_squads').select('player_ids').eq('match_id', matchId).single()).data!
    expect(squad.player_ids).toEqual(players)
    const local = await listMatchEvents(device.db, matchId)
    const remote = must(await server.from('match_events').select('id, seq').eq('match_id', matchId).order('seq')).data!
    expect(remote.map((e) => e.id)).toEqual(local.map((e) => e.id))
    expect(must(await server.from('match_reports').select('result').eq('match_id', matchId).single()).data?.result).toBe('2-1')
    expect(await serverCount('player_match_minutes', 'match_id', matchId)).toBe(14)
    const logs = must(await server.from('client_logs').select('message').eq('team_id', team.teamId)).data!
    expect(logs.map((l) => l.message)).toContain('Error: Error técnico de prueba')
  })
})

describe('idempotencia y reintentos', () => {
  it('reenviar todo no duplica nada', async () => {
    const { team, device } = await coachWithTeam()
    const players = await addPlayers(device, 12)
    const matchId = await newMatch(device, players)
    await kickOff(device, matchId, players)
    expect((await device.push()).ok).toBe(true)

    // Como si nada se hubiera confirmado (p. ej. se cortó la red justo tras enviar).
    for (const table of [device.db.players, device.db.matches, device.db.matchSquads, device.db.matchEvents] as const) {
      await (table as typeof device.db.players).toCollection().modify({ syncState: 'pending' })
    }
    expect((await device.push()).ok).toBe(true)
    expect(await countPending(device.db)).toBe(0)
    expect(await serverCount('players', 'team_id', team.teamId)).toBe(12)
    expect(await serverCount('match_events', 'match_id', matchId)).toBe((await listMatchEvents(device.db, matchId)).length)
  })

  it('sin red: todo queda pendiente y se sube en el siguiente intento', async () => {
    const { coach, team, device } = await coachWithTeam()
    await addPlayers(device, 3)
    const offline = createClient<Database>('http://127.0.0.1:9', env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const failed = await device.push(offline)
    expect(failed.ok).toBe(false)
    expect(await countPending(device.db)).toBe(3)
    expect((await device.push(coach.client)).ok).toBe(true)
    expect(await serverCount('players', 'team_id', team.teamId)).toBe(3)
  })

  it('dos subidas simultáneas del mismo móvil: sin duplicados ni corrupción', async () => {
    const { team, device } = await coachWithTeam()
    const players = await addPlayers(device, 12)
    const matchId = await newMatch(device, players)
    await kickOff(device, matchId, players)
    const [a, b] = await Promise.all([device.push(), device.push()])
    expect(a.ok && b.ok).toBe(true)
    expect(await countPending(device.db)).toBe(0)
    expect(await serverCount('players', 'team_id', team.teamId)).toBe(12)
    expect(await serverCount('match_events', 'match_id', matchId)).toBe((await listMatchEvents(device.db, matchId)).length)
  })

  it('un dato que cambia durante la subida queda pendiente para la siguiente vuelta', async () => {
    const { device } = await coachWithTeam()
    const [id] = await addPlayers(device, 1)
    const pushing = device.push()
    device.wait(1)
    await updatePlayer(device.db, device.env, id!, { name: 'Renombrado', number: 1, active: true })
    await pushing
    // O la subida vio el cambio o el jugador sigue pendiente: nunca "synced" con el nombre viejo.
    const player = (await device.db.players.get(id!))!
    if (player.syncState === 'synced') {
      const server = must(await serviceClient().from('players').select('name').eq('id', id!).single()).data!
      expect(server.name).toBe('Renombrado')
    } else {
      expect(player.syncState).toBe('pending')
    }
  })
})

describe('conflictos: el servidor decide, sin fusión automática', () => {
  it('C-1: dorsal ya usado en el servidor → conflicto de dorsal; editarlo lo resuelve', async () => {
    const { coach, team, device } = await coachWithTeam()
    const jordi = await createUser('Jordi')
    must(await serviceClient().from('team_members').insert({ team_id: team.teamId, user_id: jordi.id, role: 'coach' }))
    const other = await phone(jordi, team)

    await createPlayer(device.db, device.env, team.teamId, { name: 'Siete de Isaac', number: 7 })
    const mine = await createPlayer(other.db, other.env, team.teamId, { name: 'Siete de Jordi', number: 7 })
    expect((await device.push()).ok).toBe(true)

    const result = await other.push()
    expect(result.newConflicts).toBe(1)
    const local = (await other.db.players.get(mine.ok ? mine.value.id : ''))!
    expect(local).toMatchObject({ syncState: 'conflict', syncIssue: 'NUMBER_TAKEN', name: 'Siete de Jordi' })
    const server = must(await coach.client.from('players').select('name, number').eq('team_id', team.teamId)).data!
    expect(server).toEqual([{ name: 'Siete de Isaac', number: 7 }])
    // Un conflicto no se reintenta solo…
    expect((await other.push()).newConflicts).toBe(0)
    // …hasta que el entrenador lo cambia.
    other.wait(1)
    await updatePlayer(other.db, other.env, local.id, { name: 'Siete de Jordi', number: 8, active: true })
    expect((await other.push()).ok).toBe(true)
    expect((await other.db.players.get(local.id))?.syncState).toBe('synced')
  })

  it('C-2: datos o convocatoria de un partido que otro móvil ya empezó → rechazado, el servidor no cambia', async () => {
    const { coach, team, device } = await coachWithTeam()
    const players = await addPlayers(device, 12)
    const matchId = await newMatch(device, players)
    expect((await device.push()).ok).toBe(true)

    // Otro móvil (Jordi) empieza el partido en el servidor.
    const jordi = await createUser('Jordi')
    must(await serviceClient().from('team_members').insert({ team_id: team.teamId, user_id: jordi.id, role: 'coach' }))
    const t0 = Date.now()
    const lineup = lineupOf('4-3-3', players.slice(0, 11))
    const base = { device_id: 'movil-jordi', half: null, match_second: null, player_id: null, related_player_id: null, substitution_id: null, slot_id: null }
    must(
      await appendRaw(jordi, matchId, [
        { ...base, id: randomUUID(), seq: 1, type: 'SETUP_STARTED', occurred_at: t0, payload: {} },
        { ...base, id: randomUUID(), seq: 2, type: 'LINEUP_CONFIRMED', occurred_at: t0, half: 1, payload: { lineup } },
        { ...base, id: randomUUID(), seq: 3, type: 'MATCH_STARTED', occurred_at: t0, payload: { halfDurationS: 2700, squad: players } },
        { ...base, id: randomUUID(), seq: 4, type: 'HALF_STARTED', occurred_at: t0, half: 1, match_second: 0, payload: {} },
      ]),
    )

    // Isaac, sin saberlo, cambia la ubicación y la convocatoria en su móvil.
    device.wait(60)
    await updateMatchDetails(device.db, device.env, matchId, {
      opponent: 'CD Málaga',
      matchDate: '2026-10-10',
      kickoffTime: '18:00',
      location: 'Otro campo',
    })
    await saveSquad(device.db, device.env, matchId, players.slice(0, 11), coach.id)
    const result = await device.push()
    expect(result.newConflicts).toBe(2)
    expect(await device.db.matches.get(matchId)).toMatchObject({ syncState: 'conflict', syncIssue: 'MATCH_LOCKED' })
    expect(await device.db.matchSquads.get(matchId)).toMatchObject({ syncState: 'conflict', syncIssue: 'MATCH_LOCKED' })
    const server = must(await coach.client.from('matches').select('location, status').eq('id', matchId).single()).data!
    expect(server).toEqual({ location: 'Campo Municipal', status: 'first_half' })
    const squad = must(await coach.client.from('match_squads').select('player_ids').eq('match_id', matchId).single()).data!
    expect(squad.player_ids).toEqual(players)
  })
})

describe('pérdida de control: A sin conexión → B toma el control → A reconecta', () => {
  it('el servidor rechaza; los eventos de A van a cuarentena; el partido queda CONTROL PERDIDO', async () => {
    const { coach, team, device: a } = await coachWithTeam()
    const players = await addPlayers(a, 14)
    const matchId = await newMatch(a, players)
    await kickOff(a, matchId, players)
    expect((await a.push()).ok).toBe(true)
    const acceptedBefore = (await listMatchEvents(a.db, matchId)).length

    // A, SIN CONEXIÓN, registra 57' Jugador 10 → Jugador 12 (en la 1ª parte de este test, minuto 30).
    a.wait(30 * 60)
    await a.run(matchId, { type: 'SUBSTITUTE', outPlayerId: players[9]!, inPlayerId: players[11]! })
    const offlineEvents = (await listMatchEvents(a.db, matchId)).filter((e) => e.syncState === 'pending')
    expect(offlineEvents).toHaveLength(2)

    // Mientras, B toma el control en el servidor (siguiente seq).
    const jordi = await createUser('Jordi')
    must(await serviceClient().from('team_members').insert({ team_id: team.teamId, user_id: jordi.id, role: 'coach' }))
    const takeover = {
      ...toRemoteEvent(offlineEvents[0]!),
      id: randomUUID(),
      type: 'CONTROL_TAKEN' as const,
      device_id: 'movil-de-jordi',
      half: null,
      match_second: null,
      player_id: null,
      related_player_id: null,
      substitution_id: null,
      slot_id: null,
      payload: {},
    }
    const taken = must(await appendRaw(jordi, matchId, [takeover]))
    expect(taken.data).toMatchObject({ rejected: null })

    // A reconecta y sincroniza.
    const report = await a.push()
    expect(report.controlLost).toEqual([matchId])
    expect(report.quarantined).toBe(2)

    // Cuarentena separada del historial válido.
    const valid = await listMatchEvents(a.db, matchId)
    expect(valid).toHaveLength(acceptedBefore)
    expect(valid.every((e) => e.syncState === 'synced')).toBe(true)
    const quarantine = await a.db.rejectedEvents.where('matchId').equals(matchId).sortBy('seq')
    expect(quarantine.map((q) => [q.event.type, q.reason])).toEqual([
      ['PLAYER_OUT', 'SEQ_CONFLICT'],
      ['PLAYER_IN', 'SEQ_CONFLICT'],
    ])
    expect((await loadMatchState(a.db, matchId)).substitutions).toEqual([])
    expect((await a.db.matches.get(matchId))?.controlLostAt).toBeTruthy()

    // A ya no puede escribir: ni cambios ni final automático.
    const blocked = await runMatchCommand(a.db, a.env, matchId, { type: 'SUBSTITUTE', outPlayerId: players[9]!, inPlayerId: players[12]! }, a.actor)
    expect(blocked).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
    a.wait(60 * 60)
    expect(await advanceMatch(a.db, a.env, matchId, a.actor)).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })

    // El servidor no tiene NADA de lo rechazado; el control es de B.
    const remote = must(await coach.client.from('match_events').select('id, event_type, device_id').eq('match_id', matchId).order('seq')).data!
    expect(remote.some((e) => offlineEvents.some((o) => o.id === e.id))).toBe(false)
    expect(remote.at(-1)).toMatchObject({ event_type: 'CONTROL_TAKEN', device_id: 'movil-de-jordi' })

    // Una nueva pasada no reintenta nada de ese partido.
    expect(await a.push()).toMatchObject({ controlLost: [], quarantined: 0 })
    expect(await countPending(a.db)).toBe(0)
  })
})
