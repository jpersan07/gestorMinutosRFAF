import { describe, expect, it } from 'vitest'
import { lineupOnField, type Id, type MatchCommand, type MatchEvent } from '../../domain'
import {
  acknowledgeControlLoss,
  adoptServerVersion,
  applyTeamContext,
  canAcknowledgeControlLoss,
  createMatch,
  createPlayer,
  DownloadGapError,
  listMatchEvents,
  loadMatchState,
  matchClockOffset,
  mergeMatchDetails,
  mergePlayers,
  mergeServerEvents,
  runMatchCommand,
  runPush,
  saveSquad,
  ServerClock,
  sinceWithOverlap,
  syncOnce,
  takeControl,
  updatePlayer,
  type ServerRow,
} from '..'
import { FakeServer } from './fakeServer'
import { lineupOf, openTestDb, T0, TEST_TEAM_CONTEXT } from './testDb'

const MIN = 60_000

/** Un móvil: su base de datos, su reloj (con desfase respecto al servidor) y su cuenta. */
async function phone(server: FakeServer, userId: Id, name: string, skewMs = 0) {
  const db = openTestDb()
  const clock = new ServerClock(() => server.time + skewMs)
  let next = 0
  const env = clock.env(() => `${name}-${String(++next).padStart(4, '0')}`)
  const scope = await applyTeamContext(db, env, userId, TEST_TEAM_CONTEXT)
  const context = { db, supabase: server.supabase(userId), remote: server.remote(userId), scope, clock }
  const actor = { deviceId: scope.deviceId, coachId: userId }
  return {
    db,
    env,
    clock,
    scope,
    context,
    actor,
    sync: (matchId?: Id) => syncOnce(context, matchId ? { matchId } : {}),
    take: (matchId: Id, online = true) => takeControl({ ...context, env, online }, matchId),
    command: (matchId: Id, command: MatchCommand) => runMatchCommand(db, env, matchId, command, actor),
    run: async (matchId: Id, command: MatchCommand) => {
      const result = await runMatchCommand(db, env, matchId, command, actor)
      if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
      return result.value
    },
    state: (matchId: Id) => loadMatchState(db, matchId),
    match: async (matchId: Id) => (await db.matches.get(matchId))!,
  }
}

const wait = (server: FakeServer, ms: number) => {
  server.time += ms
}

/** A crea 14 jugadores y un partido, lo empieza y lo sube. */
async function liveMatch(options: { skewA?: number } = {}) {
  const server = new FakeServer(TEST_TEAM_CONTEXT.team.id)
  const a = await phone(server, 'user-isaac', 'A', options.skewA ?? 0)
  const players: Id[] = []
  for (let n = 1; n <= 14; n++) {
    const result = await createPlayer(a.db, a.env, a.scope.teamId, { name: `Jugador ${n}`, number: n })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    players.push(result.value.id)
  }
  const created = await createMatch(a.db, a.env, a.scope, { opponent: 'CD Málaga', matchDate: null, kickoffTime: null, location: null })
  if (!created.ok) throw new Error('partido')
  const matchId = created.value.id
  await saveSquad(a.db, a.env, matchId, players, a.scope.userId)
  await a.sync()
  await a.run(matchId, { type: 'START_SETUP' })
  await a.run(matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', players.slice(0, 11)) })
  await a.run(matchId, { type: 'START_MATCH' })
  expect((await a.sync()).ok).toBe(true)
  return { server, a, players, matchId }
}

const sub = (players: Id[], out: number, inn: number): MatchCommand => ({
  type: 'SUBSTITUTE',
  outPlayerId: players[out - 1]!,
  inPlayerId: players[inn - 1]!,
})

const shape = (events: readonly MatchEvent[]) => events.map((e) => [e.seq, e.id, e.type])

describe('descarga de eventos: se añaden, nunca "gana el último"', () => {
  it('un móvil nuevo descarga el equipo y el partido; los eventos llegan en orden de seq', async () => {
    const { server, a, players, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    expect((await b.sync()).ok).toBe(true)

    expect((await b.db.players.toArray()).map((p) => p.id).sort()).toEqual([...players].sort())
    expect((await b.db.players.toArray()).every((p) => p.syncState === 'synced')).toBe(true)
    expect(await b.db.seasons.count()).toBe(1)
    expect((await b.db.matchSquads.get(matchId))?.playerIds).toEqual(players)
    expect(shape(await listMatchEvents(b.db, matchId))).toEqual(shape(await listMatchEvents(a.db, matchId)))
    expect(await b.state(matchId)).toEqual(await a.state(matchId))
    expect(await b.match(matchId)).toMatchObject({
      status: 'first_half',
      controllerDeviceId: a.scope.deviceId,
      managedBy: 'user-isaac',
      syncState: 'synced',
    })
  })

  it('cursor de eventos: solo se piden los de seq > último sincronizado', async () => {
    const { server, a, players, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    const asked: number[] = []
    const original = b.context.remote.matchEventsAfter
    b.context.remote.matchEventsAfter = (id, after) => {
      asked.push(after)
      return original(id, after)
    }
    wait(server, 10 * MIN)
    await a.run(matchId, sub(players, 10, 12))
    await a.sync()
    await b.sync()
    expect(asked).toEqual([4])
    expect((await b.state(matchId)).substitutions).toHaveLength(1)
    // Sin eventos nuevos no se pide nada.
    await b.sync()
    expect(asked).toEqual([4])
  })

  it('un evento que ya está en el móvil nunca se modifica (aunque el servidor lo devuelva distinto)', async () => {
    const { server, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    const before = await listMatchEvents(b.db, matchId)
    const tampered = server.eventsOf(matchId).map((row) =>
      row.seq === 2 ? { ...row, occurred_at: new Date(T0 + 99 * MIN).toISOString(), device_id: 'otro' } : row,
    )
    const { fromRemoteEvent } = await import('../remote/eventMapping')
    const outcome = await mergeServerEvents(b.db, matchId, tampered.map(fromRemoteEvent), {
      me: b.scope,
      serverLastSeq: tampered.length,
      now: server.time,
    })
    expect(outcome).toMatchObject({ added: 0, quarantined: 0 })
    expect(await listMatchEvents(b.db, matchId)).toEqual(before)
  })

  it('mismo seq con distinto id: el evento local (y lo posterior) va a cuarentena; entra el del servidor', async () => {
    const { server, a, players, matchId } = await liveMatch()
    wait(server, 10 * MIN)
    await a.run(matchId, sub(players, 10, 12)) // pendiente: seq 5 y 6
    const local = await listMatchEvents(a.db, matchId)
    const serverEvent: MatchEvent = { ...local[3]!, id: 'del-servidor', seq: 5, type: 'CONTROL_TAKEN', deviceId: 'movil-B', coachId: 'user-jordi' } as MatchEvent
    const outcome = await mergeServerEvents(a.db, matchId, [serverEvent], { me: a.scope, serverLastSeq: 5, now: server.time })
    expect(outcome).toMatchObject({ added: 1, quarantined: 2, controlLost: true, complete: true })
    expect((await a.db.rejectedEvents.where('matchId').equals(matchId).sortBy('seq')).map((r) => [r.seq, r.event.type, r.reason])).toEqual([
      [5, 'PLAYER_OUT', 'SEQ_CONFLICT'],
      [6, 'PLAYER_IN', 'SEQ_CONFLICT'],
    ])
    expect((await listMatchEvents(a.db, matchId)).at(-1)).toMatchObject({ id: 'del-servidor', syncState: 'synced' })
    expect(await a.match(matchId)).toMatchObject({ controllerDeviceId: 'movil-B' })
    expect((await a.match(matchId)).controlLostAt).toBeTruthy()
    expect(await a.command(matchId, sub(players, 9, 13))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
  })

  it('una descarga con huecos no guarda nada (el historial local nunca tiene huecos)', async () => {
    const { server, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    const { fromRemoteEvent } = await import('../remote/eventMapping')
    await mergeMatchDetails(b.db, [server.row('matches', matchId)!], server.time)
    const withGap = server.eventsOf(matchId).filter((e) => e.seq !== 3).map(fromRemoteEvent)
    await expect(
      mergeServerEvents(b.db, matchId, withGap, { me: b.scope, serverLastSeq: 4, now: server.time }),
    ).rejects.toBeInstanceOf(DownloadGapError)
    expect(await listMatchEvents(b.db, matchId)).toEqual([])
  })
})

describe('descarga de datos editables: "gana el último" como el servidor', () => {
  it('regla de sustitución de la versión local', () => {
    expect(adoptServerVersion(undefined, 10)).toBe(true)
    expect(adoptServerVersion({ syncState: 'synced', version: 10 }, 20)).toBe(true)
    expect(adoptServerVersion({ syncState: 'synced', version: 10 }, 10)).toBe(false) // sin cambios
    expect(adoptServerVersion({ syncState: 'pending', version: 30 }, 20)).toBe(false) // la local es más reciente
    expect(adoptServerVersion({ syncState: 'pending', version: 20 }, 20)).toBe(false) // igual: el servidor aceptará la local
    expect(adoptServerVersion({ syncState: 'pending', version: 20 }, 21)).toBe(true) // el servidor es estrictamente más reciente
    expect(adoptServerVersion({ syncState: 'conflict', syncIssue: 'NUMBER_TAKEN', version: 1 }, 99)).toBe(false)
    expect(adoptServerVersion({ syncState: 'conflict', syncIssue: 'MATCH_LOCKED', version: 99 }, 1)).toBe(true)
  })

  it('jugadores: el cambio pendiente más reciente se conserva; el más antiguo se sustituye', async () => {
    const { server, a, players } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    const [p1, p2] = [players[0]!, players[1]!]

    // B edita p1 sin subir; después A edita p1 y lo sube: el servidor tiene una versión MÁS RECIENTE.
    wait(server, MIN)
    await updatePlayer(b.db, b.env, p1, { name: 'B antiguo', number: 1, active: true })
    wait(server, MIN)
    await updatePlayer(a.db, a.env, p1, { name: 'A reciente', number: 1, active: true })
    // A edita p2 y lo sube; después B edita p2 sin subir: la versión local de B es más reciente.
    await updatePlayer(a.db, a.env, p2, { name: 'A antiguo', number: 2, active: true })
    await a.sync()
    wait(server, MIN)
    await updatePlayer(b.db, b.env, p2, { name: 'B reciente', number: 2, active: true })

    await mergePlayers(b.db, [server.row('players', p1)!, server.row('players', p2)!])
    expect(await b.db.players.get(p1)).toMatchObject({ name: 'A reciente', syncState: 'synced' })
    expect(await b.db.players.get(p2)).toMatchObject({ name: 'B reciente', syncState: 'pending' })

    // La siguiente pasada sube la de B y el servidor la acepta: ambos móviles convergen.
    await b.sync()
    await a.sync()
    expect(server.row('players', p2)?.name).toBe('B reciente')
    expect(await a.db.players.get(p2)).toMatchObject({ name: 'B reciente', syncState: 'synced' })
  })

  it('dorsal ocupado (C-1) se mantiene; partido bloqueado (C-2) toma la versión del servidor con aviso', async () => {
    const { server, a, players, matchId } = await liveMatch()
    await a.db.players.update(players[0]!, { syncState: 'conflict', syncIssue: 'NUMBER_TAKEN', name: 'Mi cambio' })
    await a.db.matches.update(matchId, { syncState: 'conflict', syncIssue: 'MATCH_LOCKED', opponent: 'Cambio tarde' })
    await mergePlayers(a.db, [server.row('players', players[0]!)!])
    await mergeMatchDetails(a.db, [server.row('matches', matchId)!], server.time)
    expect(await a.db.players.get(players[0]!)).toMatchObject({ name: 'Mi cambio', syncState: 'conflict' })
    expect(await a.match(matchId)).toMatchObject({ opponent: 'CD Málaga', syncState: 'synced', syncIssue: 'MATCH_LOCKED' })
  })

  it('los datos editables del partido nunca tocan su estado ni su control', async () => {
    const { server, a, matchId } = await liveMatch()
    const row: ServerRow<'matches'> = {
      ...server.row('matches', matchId)!,
      status: 'saved',
      controller_device_id: 'otro',
      updated_at: new Date(T0 + 60 * MIN).toISOString(),
      opponent: 'Rival renombrado',
    }
    await mergeMatchDetails(a.db, [row], server.time)
    expect(await a.match(matchId)).toMatchObject({
      opponent: 'Rival renombrado',
      status: 'first_half',
      controllerDeviceId: a.scope.deviceId,
    })
  })

  it('cursor con la hora del SERVIDOR y 2 minutos de margen; no avanza si falla la descarga de eventos', async () => {
    expect(sinceWithOverlap(null)).toBeNull()
    expect(sinceWithOverlap('2026-09-28T16:10:00.000Z')).toBe('2026-09-28T16:08:00.000Z')

    const { server, a, players, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    const first = server.calls.filter((c) => c.table === 'matches')
    expect(first.at(-1)?.since).toBeNull() // móvil nuevo: todo
    const cursor = (await b.db.meta.get(`cursor:${b.scope.teamId}:matches`))?.value as string
    expect(cursor).toBe(server.row('matches', matchId)?.synced_at)

    // Falla la descarga de los eventos nuevos: el cursor de partidos NO avanza.
    wait(server, 10 * MIN)
    await a.run(matchId, sub(players, 10, 12))
    await a.sync()
    const original = b.context.remote.matchEventsAfter
    b.context.remote.matchEventsAfter = () => Promise.reject(new TypeError('Failed to fetch'))
    expect((await b.sync()).ok).toBe(false)
    expect((await b.db.meta.get(`cursor:${b.scope.teamId}:matches`))?.value).toBe(cursor)
    expect(server.calls.filter((c) => c.table === 'matches').at(-1)?.since).toBe(sinceWithOverlap(cursor))

    // Al reintentar, llega todo.
    b.context.remote.matchEventsAfter = original
    expect((await b.sync()).ok).toBe(true)
    expect((await b.state(matchId)).substitutions).toHaveLength(1)
  })
})

describe('modo consulta', () => {
  it('quien no controla no genera eventos; la descarga del partido abierto trae los cambios', async () => {
    const { server, a, players, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    expect(await b.command(matchId, sub(players, 10, 12))).toMatchObject({ ok: false, error: { code: 'NOT_CONTROLLER' } })
    // TOMAR CONTROL nunca se registra solo en el móvil.
    expect(await b.command(matchId, { type: 'TAKE_CONTROL' })).toEqual({
      ok: false,
      error: { code: 'TAKE_CONTROL_REQUIRES_SERVER' },
    })
    expect(await listMatchEvents(b.db, matchId)).toHaveLength(4)

    wait(server, 12 * MIN)
    await a.run(matchId, sub(players, 10, 12))
    await a.sync()
    const before = server.calls.length
    await b.sync(matchId) // pasada de modo consulta: solo este partido
    expect(server.calls.length).toBe(before) // sin descargas por cursor del resto de tablas
    expect((await b.state(matchId)).substitutions).toMatchObject([{ matchSecond: 12 * 60 }])
  })
})

describe('TOMAR CONTROL', () => {
  it('aceptado por el servidor: el móvil pasa a controlar; el anterior lo ve al descargar', async () => {
    const { server, a, players, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    wait(server, 5 * MIN)
    expect(await b.take(matchId)).toEqual({ ok: true })
    expect(server.row('matches', matchId)).toMatchObject({ controller_device_id: b.scope.deviceId, control_epoch: 2 })
    expect(await b.match(matchId)).toMatchObject({ controllerDeviceId: b.scope.deviceId, managedBy: 'user-jordi' })
    expect((await listMatchEvents(b.db, matchId)).at(-1)).toMatchObject({ type: 'CONTROL_TAKEN', syncState: 'synced' })

    wait(server, 5 * MIN)
    await b.run(matchId, sub(players, 10, 12))
    expect((await b.sync()).ok).toBe(true)

    // A (con conexión y sin nada pendiente) descarga: pierde el control sin cuarentena.
    const report = await a.sync()
    expect(report.controlLost).toEqual([matchId])
    expect(await a.match(matchId)).toMatchObject({ controlLossReason: 'TAKEN_BY_OTHER' })
    expect(await a.db.rejectedEvents.count()).toBe(0)
    expect(await a.state(matchId)).toEqual(await b.state(matchId))
    expect(canAcknowledgeControlLoss(await a.match(matchId), await listMatchEvents(a.db, matchId), a.scope)).toBe(true)
    expect(await a.command(matchId, sub(players, 9, 13))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
  })

  it('control_epoch: con un epoch que ya no es el actual el servidor responde CONTROL_CHANGED', async () => {
    const { server, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    expect(await b.take(matchId)).toEqual({ ok: true })
    const stale = await server.takeControl('user-isaac', matchId, 1, {
      id: 'toma-tardia',
      seq: 7,
      type: 'CONTROL_TAKEN',
      occurred_at: server.time,
      device_id: 'movil-C',
      half: null,
      match_second: null,
      player_id: null,
      related_player_id: null,
      substitution_id: null,
      slot_id: null,
      payload: {},
    })
    expect(stale.rejected?.reason).toBe('CONTROL_CHANGED')
    expect(server.row('matches', matchId)).toMatchObject({ controller_device_id: b.scope.deviceId, control_epoch: 2 })
  })

  it('dos TOMAR CONTROL simultáneos: solo uno gana; el otro queda en consulta con el estado oficial', async () => {
    const { server, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    const c = await phone(server, 'user-jordi', 'C')
    await b.sync()
    await c.sync()
    server.simultaneousTakeControls(2)
    const [rb, rc] = await Promise.all([b.take(matchId), c.take(matchId)])
    const results = [rb, rc]
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.reason === 'TAKEN_BY_OTHER')).toHaveLength(1)
    const [winner, loser] = rb.ok ? [b, c] : [c, b]
    expect(server.row('matches', matchId)?.controller_device_id).toBe(winner.scope.deviceId)
    expect((await loser.match(matchId)).controllerDeviceId).toBe(winner.scope.deviceId)
    expect(shape(await listMatchEvents(loser.db, matchId))).toEqual(shape(await listMatchEvents(winner.db, matchId)))
  })

  it('si el controlador registra algo mientras tanto (SEQ_CONFLICT), se descarga y se reintenta', async () => {
    const { server, a, players, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    let interfered = false
    server.beforeTakeControl = async () => {
      if (interfered) return
      interfered = true
      wait(server, MIN)
      await a.run(matchId, sub(players, 10, 12))
      await a.sync()
    }
    expect(await b.take(matchId)).toEqual({ ok: true })
    expect((await b.state(matchId)).substitutions).toHaveLength(1)
    expect((await listMatchEvents(b.db, matchId)).map((e) => e.type).slice(-3)).toEqual(['PLAYER_OUT', 'PLAYER_IN', 'CONTROL_TAKEN'])
  })

  it('sin conexión no se intenta; si falla la red no cambia NADA en el móvil', async () => {
    const { server, a, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()
    const before = await listMatchEvents(b.db, matchId)

    expect(await b.take(matchId, false)).toEqual({ ok: false, reason: 'OFFLINE' })
    server.offline = true
    expect(await b.take(matchId)).toEqual({ ok: false, reason: 'NETWORK' })
    server.offline = false
    expect(await listMatchEvents(b.db, matchId)).toEqual(before)
    expect(await b.match(matchId)).toMatchObject({ controllerDeviceId: a.scope.deviceId })

    // El servidor lo procesa pero la respuesta se pierde: el móvil NO se considera controlador…
    server.loseTakeControlResponse = true
    expect(await b.take(matchId)).toEqual({ ok: false, reason: 'NETWORK' })
    server.loseTakeControlResponse = false
    expect(await listMatchEvents(b.db, matchId)).toEqual(before)
    expect((await b.match(matchId)).controllerDeviceId).toBe(a.scope.deviceId)
    // …hasta que la descarga trae su CONTROL_TAKEN aceptado por el servidor.
    await b.sync()
    expect((await b.match(matchId)).controllerDeviceId).toBe(b.scope.deviceId)
  })
})

describe('A sin conexión → B toma el control → A reconecta', () => {
  it('cuarentena, CONTROL PERDIDO, estado oficial de B, ENTENDIDO solo después y recuperar el control', async () => {
    const { server, a, players, matchId } = await liveMatch()
    const b = await phone(server, 'user-jordi', 'B')
    await b.sync()

    // A, sin conexión (no sincroniza), registra un cambio.
    wait(server, 10 * MIN)
    await a.run(matchId, sub(players, 10, 12))
    // B toma el control y registra otro cambio.
    wait(server, MIN)
    expect(await b.take(matchId)).toEqual({ ok: true })
    wait(server, 4 * MIN)
    await b.run(matchId, sub(players, 9, 13))
    await b.sync()

    // A reconecta: la SUBIDA se rechaza → cuarentena + CONTROL PERDIDO (aún sin estado oficial).
    const pushed = await runPush(a.context)
    expect(pushed).toMatchObject({ controlLost: [matchId], quarantined: 2 })
    const lostMatch = await a.match(matchId)
    expect(lostMatch.controlLostAt).toBeTruthy()
    expect(lostMatch.officialStateAt).toBeNull()
    expect(canAcknowledgeControlLoss(lostMatch, await listMatchEvents(a.db, matchId), a.scope)).toBe(false)
    expect(await acknowledgeControlLoss(a.db, a.env, matchId, a.scope)).toEqual({
      ok: false,
      error: { code: 'OFFICIAL_STATE_PENDING' },
    })

    // La descarga trae el estado oficial: A queda exactamente como lo dejó B.
    expect((await a.sync()).ok).toBe(true)
    expect(await a.state(matchId)).toEqual(await b.state(matchId))
    expect((await a.state(matchId)).substitutions).toMatchObject([{ outPlayerId: players[8], inPlayerId: players[12] }])
    expect((await a.db.rejectedEvents.where('matchId').equals(matchId).toArray()).map((r) => r.event.type).sort()).toEqual([
      'PLAYER_IN',
      'PLAYER_OUT',
    ])
    expect(await a.command(matchId, sub(players, 11, 14))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
    const { advanceMatch } = await import('..')
    expect(await advanceMatch(a.db, a.env, matchId, a.actor)).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })

    // ENTENDIDO: ahora sí; solo oculta el aviso (sigue sin poder escribir).
    expect(await acknowledgeControlLoss(a.db, a.env, matchId, a.scope)).toEqual({ ok: true, value: undefined })
    expect((await a.match(matchId)).controlLossAcknowledgedAt).toBeTruthy()
    expect(await a.command(matchId, sub(players, 11, 14))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })

    // A vuelve a TOMAR CONTROL por el flujo del servidor: vuelve a trabajar desde el estado oficial.
    wait(server, MIN)
    expect(await a.take(matchId)).toEqual({ ok: true })
    expect(await a.match(matchId)).toMatchObject({ controlLostAt: null, controllerDeviceId: a.scope.deviceId })
    await a.run(matchId, sub(players, 11, 14))
    expect((await a.sync()).ok).toBe(true)
    // La cuarentena NO se reaplica ni se borra.
    expect(await a.db.rejectedEvents.where('matchId').equals(matchId).count()).toBe(2)
    expect((await a.state(matchId)).substitutions).toHaveLength(2)

    // B se entera al descargar.
    expect((await b.sync()).controlLost).toEqual([matchId])
    expect(await b.state(matchId)).toEqual(await a.state(matchId))
  })
})

describe('reloj: el servidor es la referencia', () => {
  it('mide la diferencia con la hora del servidor e ignora ruido y medidas lentas', async () => {
    let device = 1_000_000
    const clock = new ServerClock(() => device)
    expect(await clock.measure(async () => device + 90_000)).toBe(90_000)
    expect(clock.offsetMs).toBe(90_000)
    expect(clock.now()).toBe(device + 90_000)
    await clock.measure(async () => device + 90_200) // < 500 ms: no se aplica
    expect(clock.offsetMs).toBe(90_000)
    const slow = clock.measure(async () => {
      device += 6_000
      return device
    })
    expect(await slow).toBeNull()
    expect(clock.offsetMs).toBe(90_000)
  })

  it('la corrección de los eventos se congela para cada periodo de control desde PLAY', () => {
    const control = { type: 'SETUP_STARTED', id: 'c1', seq: 1 } as MatchEvent
    const started = { type: 'MATCH_STARTED', id: 's', seq: 3 } as MatchEvent
    const frozen = { clockOffset: { ms: 1_000, controlEventId: 'c1' } }
    expect(matchClockOffset(frozen, [control], 5_000)).toEqual({ ms: 5_000, controlEventId: 'c1' }) // antes de PLAY
    expect(matchClockOffset(frozen, [control, started], 5_000)).toEqual(frozen.clockOffset) // congelada
    const taken = { type: 'CONTROL_TAKEN', id: 'c2', seq: 9 } as MatchEvent
    expect(matchClockOffset(frozen, [control, started, taken], 5_000)).toEqual({ ms: 5_000, controlEventId: 'c2' })
  })

  it('dos móviles con relojes distintos (+90 s y −75 s) generan tiempos coherentes', async () => {
    const { server, a, players, matchId } = await liveMatch({ skewA: 90_000 })
    const kickOff = (await listMatchEvents(a.db, matchId)).find((e) => e.type === 'HALF_STARTED')!
    // A empezó a la hora del SERVIDOR aunque su reloj vaya 90 s adelantado.
    expect(kickOff.occurredAt).toBe(T0)

    const b = await phone(server, 'user-jordi', 'B', -75_000)
    await b.sync()
    wait(server, 10 * MIN)
    expect(await b.take(matchId)).toEqual({ ok: true })
    wait(server, 10 * MIN)
    await b.run(matchId, sub(players, 10, 12))
    const out = (await listMatchEvents(b.db, matchId)).find((e) => e.type === 'PLAYER_OUT')!
    expect(out.occurredAt).toBe(T0 + 20 * MIN)
    expect(out.type === 'PLAYER_OUT' && out.matchSecond).toBe(20 * 60)

    // A mitad de un periodo de control la referencia no cambia aunque cambie la medida.
    await b.clock.measure(async () => server.time + 10_000)
    expect(b.clock.offsetMs).not.toBe(75_000)
    wait(server, MIN)
    await b.run(matchId, sub(players, 9, 13))
    const second = (await listMatchEvents(b.db, matchId)).filter((e) => e.type === 'PLAYER_OUT').at(-1)!
    expect(second.type === 'PLAYER_OUT' && second.matchSecond).toBe(21 * 60)

    // A descarga y ve exactamente los mismos minutos.
    expect((await b.sync()).ok).toBe(true)
    await a.sync()
    expect((await a.state(matchId)).substitutions.map((s) => s.matchSecond)).toEqual([20 * 60, 21 * 60])
    expect(lineupOnField(await a.state(matchId))).toEqual(lineupOnField(await b.state(matchId)))
  })
})
