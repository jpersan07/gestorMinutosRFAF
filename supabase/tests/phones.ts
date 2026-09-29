import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import {
  AppDatabase,
  applyTeamContext,
  createMatch as createLocalMatch,
  createPlayer,
  getDeviceId,
  loadMatchState,
  loadTeamContext,
  runMatchCommand,
  runPush,
  saveSquad,
  ServerClock,
  supabaseRemote,
  syncOnce,
  takeControl,
  type DataEnv,
  type SyncRemote,
} from '../../src/data'
import type { Id, MatchCommand, MatchEvent } from '../../src/domain'
import { lineupOf } from '../../src/domain/__tests__/harness'
import { createUser, must, serviceClient, type TestTeam, type TestUser } from './helpers'

// "Móviles" con la app real (IndexedDB simulado + código de sincronización) contra el Supabase
// LOCAL, para los tests de varios dispositivos (3d) y de horas del servidor (3e.1).

export const crestDataUrl = `data:image/png;base64,${readFileSync('public/pwa-64x64.png').toString('base64')}`
export const MIN = 60_000

/**
 * Un móvil. Con `skewMs` usa la corrección de reloj de la app (ServerClock, como en producción)
 * sobre un reloj que va desfasado. Sin él, reloj manual (`wait`) para simular minutos de partido
 * sin esperar de verdad (el servidor valida la coherencia entre segundos y horas de los eventos).
 */
export async function phone(user: TestUser, team: TestTeam, options: { skewMs?: number; corrected?: boolean } = {}) {
  const db = new AppDatabase(`phone-${randomUUID()}`)
  // Reloj manual que empieza hace unas horas: los minutos simulados nunca quedan en el futuro
  // respecto a la hora del servidor (EVENT_IN_FUTURE, 3e.1).
  const manual = { time: Date.now() - 3 * 3600_000 }
  const useClock = options.skewMs !== undefined
  const clock = useClock && options.corrected !== false ? new ServerClock(() => Date.now() + options.skewMs!) : undefined
  const env: DataEnv = clock
    ? clock.env(() => randomUUID())
    : { now: () => (useClock ? Date.now() + options.skewMs! : manual.time), newId: () => randomUUID() }
  await getDeviceId(db, env)
  const context = await loadTeamContext(user.client, team.teamId)
  const scope = await applyTeamContext(db, env, user.id, { ...context, season: context.season! })
  const remote: SyncRemote = { ...supabaseRemote(user.client) }
  const sync = { db, supabase: user.client, remote, scope, clock }
  const actor = { deviceId: scope.deviceId, coachId: user.id }
  return {
    db,
    env,
    scope,
    actor,
    remote,
    sync: (matchId?: Id) => syncOnce(sync, matchId ? { matchId } : {}),
    push: () => runPush(sync),
    take: (matchId: Id) => takeControl({ ...sync, env, online: true }, matchId),
    command: (matchId: Id, command: MatchCommand) => runMatchCommand(db, env, matchId, command, actor),
    run: async (matchId: Id, command: MatchCommand) => {
      const result = await runMatchCommand(db, env, matchId, command, actor)
      if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
      return result.value
    },
    state: (matchId: Id) => loadMatchState(db, matchId),
    match: async (matchId: Id) => (await db.matches.get(matchId))!,
    wait: (ms: number) => {
      manual.time += ms
    },
  }
}
export type Phone = Awaited<ReturnType<typeof phone>>

export async function coachInTeam(team: TestTeam, name: string) {
  const user = await createUser(name)
  must(await serviceClient().from('team_members').insert({ team_id: team.teamId, user_id: user.id, role: 'coach' }))
  return user
}

/** A: 14 jugadores, partido (con escudo) y convocatoria; lo empieza en el móvil (sin subirlo). */
export async function preparedLocally(a: Phone, options: { crest?: string } = {}) {
  const players: Id[] = []
  for (let n = 1; n <= 14; n++) {
    const result = await createPlayer(a.db, a.env, a.scope.teamId, { name: `Jugador ${n}`, number: n })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    players.push(result.value.id)
  }
  const match = await createLocalMatch(a.db, a.env, a.scope, {
    opponent: 'CD Málaga',
    matchDate: '2026-10-10',
    kickoffTime: '18:00',
    location: 'Campo Municipal',
    crest: options.crest,
  })
  if (!match.ok) throw new Error(JSON.stringify(match.error))
  const matchId = match.value.id
  await saveSquad(a.db, a.env, matchId, players, a.scope.userId)
  await a.run(matchId, { type: 'START_SETUP' })
  await a.run(matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', players.slice(0, 11)) })
  await a.run(matchId, { type: 'START_MATCH' })
  return { players, matchId }
}

/** Como preparedLocally, y además lo sube. */
export async function kickedOff(a: Phone, options: { crest?: string } = {}) {
  const prepared = await preparedLocally(a, options)
  expect((await a.sync()).ok).toBe(true)
  return prepared
}

export const sub = (players: Id[], out: number, inn: number): MatchCommand => ({
  type: 'SUBSTITUTE',
  outPlayerId: players[out - 1]!,
  inPlayerId: players[inn - 1]!,
})
export const shape = (events: readonly MatchEvent[]) => events.map((e) => [e.seq, e.id, e.type, e.occurredAt])

export async function serverEvents(user: TestUser, matchId: Id) {
  return must(await user.client.from('match_events').select('id, seq, event_type, device_id').eq('match_id', matchId).order('seq')).data!
}

