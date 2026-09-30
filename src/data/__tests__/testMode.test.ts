import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeMinutes, matchSecondAt, replay, type Id, type MatchCommand } from '../../domain'
import {
  advanceMatch,
  advanceTestClock,
  applyTeamContext,
  countPending,
  createMatch,
  createPlayer,
  goToFullTime,
  goToHalftime,
  listMatchEvents,
  loadMatchState,
  runMatchCommand,
  saveMatch,
  saveReport,
  saveSquad,
  setTestMode,
  testClock,
  testModeActive,
  testModeAvailable,
  TEST_CLOCK_BUDGET_MS,
  type Actor,
} from '..'
import { lineupOf, openTestDb, reopen, TestEnv, TEST_TEAM_CONTEXT } from './testDb'

const MIN = 60_000

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Equipo (DEMO u otro) con 14 jugadores, un partido con convocatoria y alineación confirmada. */
async function team(name: string) {
  const db = openTestDb()
  const env = new TestEnv()
  const scope = await applyTeamContext(db, env, 'user-isaac', { ...TEST_TEAM_CONTEXT, team: { ...TEST_TEAM_CONTEXT.team, name } })
  const players: Id[] = []
  for (let n = 1; n <= 14; n++) {
    const result = await createPlayer(db, env, scope.teamId, { name: `Jugador ${n}`, number: n })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    players.push(result.value.id)
  }
  const created = await createMatch(db, env, scope, { opponent: 'Rival', matchDate: null, kickoffTime: null, location: null })
  if (!created.ok) throw new Error('partido')
  const matchId = created.value.id
  await saveSquad(db, env, matchId, players, scope.userId)
  const actor: Actor = { deviceId: scope.deviceId, coachId: scope.userId }
  const run = async (command: MatchCommand) => {
    const result = await runMatchCommand(db, env, matchId, command, actor)
    if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
    return result.value
  }
  const setup = async () => {
    await run({ type: 'START_SETUP' })
    await run({ type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', players.slice(0, 11)) })
  }
  const clock = async () => {
    const match = (await db.matches.get(matchId))!
    const events = await listMatchEvents(db, matchId)
    const state = replay(matchId, events)
    const { matchNow, remainingMs } = testClock(match, events, env)
    return { state, matchNow, remainingMs, second: matchSecondAt(state, matchNow) }
  }
  const p = (n: number) => players[n - 1]!
  return { db, env, scope, players, matchId, actor, run, setup, clock, p }
}

const ok = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

describe('A/K · equipo normal: no hay modo pruebas', () => {
  it('no está disponible ni se puede activar', async () => {
    const t = await team('CD Real')
    expect(await testModeAvailable(t.db, t.matchId)).toBe(false)
    expect(await setTestMode(t.db, t.env, t.matchId, true)).toEqual({ ok: false, error: { code: 'TEST_MODE_UNAVAILABLE' } })
    expect((await t.db.matches.get(t.matchId))?.testMode).toBeFalsy()
  })

  it('manipular el navegador (localStorage, URL, el dato local) no lo activa ni cambia el reloj', async () => {
    const t = await team('CD Real')
    vi.stubGlobal('localStorage', { getItem: () => 'true', isDemo: 'true', testMode: 'true' })
    vi.stubGlobal('location', new URL('https://gestor-minutos-rfaf.vercel.app/partidos/x?modo=pruebas&demo=1'))
    // Alguien escribe a mano la marca en IndexedDB de un partido de un equipo que NO es DEMO.
    await t.db.matches.update(t.matchId, { testMode: { enabledAt: t.env.now() } })
    expect(await testModeActive(t.db, t.matchId)).toBe(false)

    await t.setup()
    await t.run({ type: 'START_MATCH' })
    // El partido empieza a la hora real: nada de fecharlo hacia atrás.
    const kickOff = (await listMatchEvents(t.db, t.matchId)).find((e) => e.type === 'HALF_STARTED')!
    expect(kickOff.occurredAt).toBe(t.env.now())
    // Y los controles de prueba se niegan.
    expect(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 10 * MIN)).toEqual({ ok: false, error: { code: 'TEST_MODE_UNAVAILABLE' } })
    expect(await goToHalftime(t.db, t.env, t.matchId, t.actor)).toEqual({ ok: false, error: { code: 'TEST_MODE_UNAVAILABLE' } })
    expect(await goToFullTime(t.db, t.env, t.matchId, t.actor)).toEqual({ ok: false, error: { code: 'TEST_MODE_UNAVAILABLE' } })
    expect((await t.clock()).second).toBe(0)
  })
})

describe('B · equipo DEMO', () => {
  it('se activa explícitamente antes de PLAY; al empezar, el partido se fecha 3 h atrás; después ya no se cambia', async () => {
    const t = await team('DEMO')
    expect(await testModeAvailable(t.db, t.matchId)).toBe(true)
    expect(await testModeActive(t.db, t.matchId)).toBe(false) // por defecto, normal
    ok(await setTestMode(t.db, t.env, t.matchId, true))
    expect(await testModeActive(t.db, t.matchId)).toBe(true)
    await t.setup()
    await t.run({ type: 'START_MATCH' })
    const kickOff = (await listMatchEvents(t.db, t.matchId)).find((e) => e.type === 'HALF_STARTED')!
    expect(kickOff.occurredAt).toBe(t.env.now() - TEST_CLOCK_BUDGET_MS)
    expect((await t.clock()).second).toBe(0)
    expect(await setTestMode(t.db, t.env, t.matchId, false)).toEqual({ ok: false, error: { code: 'TEST_MODE_UNAVAILABLE' } })
  })

  it('sin activarlo, un partido de DEMO funciona exactamente igual que los demás', async () => {
    const t = await team('DEMO')
    await t.setup()
    await t.run({ type: 'START_MATCH' })
    expect((await listMatchEvents(t.db, t.matchId)).find((e) => e.type === 'HALF_STARTED')!.occurredAt).toBe(t.env.now())
    expect(await advanceTestClock(t.db, t.env, t.matchId, t.actor, MIN)).toEqual({ ok: false, error: { code: 'TEST_MODE_UNAVAILABLE' } })
  })
})

async function demoKickedOff() {
  const t = await team('DEMO')
  ok(await setTestMode(t.db, t.env, t.matchId, true))
  await t.setup()
  await t.run({ type: 'START_MATCH' })
  return t
}

describe('C/D/E/F · reloj de pruebas con los comandos normales del dominio', () => {
  it('+1:00, +5:00 y +10:00 avanzan exactamente ese tiempo (el reloj real sigue corriendo)', async () => {
    const t = await demoKickedOff()
    t.env.wait(59) // tiempo real
    expect((await t.clock()).second).toBe(59)
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, MIN))
    expect((await t.clock()).second).toBe(119) // 00:59 → 01:59
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 5 * MIN))
    expect((await t.clock()).second).toBe(419)
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 10 * MIN))
    expect((await t.clock()).second).toBe(1019)
    expect((await t.clock()).state.status).toBe('first_half')
  })

  it('cruzar el 45:00 cierra la 1ª parte a la hora exacta (tick normal)', async () => {
    const t = await demoKickedOff()
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 40 * MIN))
    const state = ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 10 * MIN))
    expect(state.status).toBe('halftime')
    expect(state.halfEndedAt[1]).toBe(state.halfStartedAt[1]! + 45 * MIN)
  })

  it('IR A DESCANSO: FIRST_HALF → HALFTIME con el final exacto de la 1ª parte', async () => {
    const t = await demoKickedOff()
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 12 * MIN))
    const state = ok(await goToHalftime(t.db, t.env, t.matchId, t.actor))
    expect(state.status).toBe('halftime')
    const last = (await listMatchEvents(t.db, t.matchId)).at(-1)!
    expect(last).toMatchObject({ type: 'HALF_ENDED', half: 1, matchSecond: 2700, occurredAt: state.halfStartedAt[1]! + 45 * MIN })
    // Solo en la 1ª parte.
    expect((await goToHalftime(t.db, t.env, t.matchId, t.actor)).ok).toBe(false)
  })

  it('HALFTIME → SECOND_HALF sigue exigiendo alineación y los 15 s de descanso', async () => {
    const t = await demoKickedOff()
    const halftime = ok(await goToHalftime(t.db, t.env, t.matchId, t.actor))
    expect((await runMatchCommand(t.db, t.env, t.matchId, { type: 'START_SECOND_HALF' }, t.actor)).ok).toBe(false)
    await t.run({ type: 'CONFIRM_LINEUP', lineup: { formationId: '4-3-3', slots: halftime.lineups[1]!.slots } })
    expect(await runMatchCommand(t.db, t.env, t.matchId, { type: 'START_SECOND_HALF' }, t.actor)).toMatchObject({
      ok: false,
      error: { code: 'HALFTIME_WAIT' },
    })
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 15_000))
    expect((await t.run({ type: 'START_SECOND_HALF' })).status).toBe('second_half')
  })

  it('IR A 90:00 desde la 1ª parte: descanso, alineación, 2ª parte y final, sin saltarse nada; después, guardar', async () => {
    const t = await demoKickedOff()
    const state = ok(await goToFullTime(t.db, t.env, t.matchId, t.actor))
    expect(state.status).toBe('finished')
    const types = (await listMatchEvents(t.db, t.matchId)).map((e) => e.type)
    expect(types).toEqual([
      'SETUP_STARTED',
      'LINEUP_CONFIRMED',
      'MATCH_STARTED',
      'HALF_STARTED',
      'HALF_ENDED',
      'LINEUP_CONFIRMED',
      'HALF_STARTED',
      'HALF_ENDED',
      'MATCH_ENDED',
    ])
    expect(state.halfStartedAt[2]! - state.halfEndedAt[1]!).toBe(15_000)
    expect(state.halfEndedAt[2]).toBe(state.halfStartedAt[2]! + 45 * MIN)
    // Resultado y guardado, como en cualquier partido.
    ok(await saveReport(t.db, t.env, t.matchId, { result: '2-1', observations: 'Prueba' }, t.scope.userId))
    expect(ok(await saveMatch(t.db, t.env, t.matchId, t.actor)).status).toBe('saved')
  })

  it('nunca fecha un evento en el futuro; si el margen se agota, se niega', async () => {
    const t = await demoKickedOff()
    ok(await goToFullTime(t.db, t.env, t.matchId, t.actor))
    for (const event of await listMatchEvents(t.db, t.matchId)) expect(event.occurredAt).toBeLessThanOrEqual(t.env.now())
    const t2 = await demoKickedOff()
    const { remainingMs } = await t2.clock()
    expect(remainingMs).toBe(TEST_CLOCK_BUDGET_MS - 5_000)
    expect(await advanceTestClock(t2.db, t2.env, t2.matchId, t2.actor, remainingMs + 1)).toEqual({
      ok: false,
      error: { code: 'TEST_CLOCK_EXHAUSTED' },
    })
  })

  it('solo el dispositivo que controla el partido puede adelantar el reloj', async () => {
    const t = await demoKickedOff()
    const other: Actor = { deviceId: 'otro-movil', coachId: 'user-jordi' }
    expect(await advanceTestClock(t.db, t.env, t.matchId, other, MIN)).toMatchObject({ ok: false, error: { code: 'NOT_CONTROLLER' } })
  })
})

describe('G · sustituciones y reentradas con el reloj adelantado', () => {
  it('los minutos salen de los eventos, como siempre', async () => {
    const t = await demoKickedOff()
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 10 * MIN))
    await t.run({ type: 'SUBSTITUTE', outPlayerId: t.p(10), inPlayerId: t.p(12) }) // 10'
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 20 * MIN))
    await t.run({ type: 'SUBSTITUTE', outPlayerId: t.p(12), inPlayerId: t.p(10) }) // 30': vuelve a entrar
    ok(await goToFullTime(t.db, t.env, t.matchId, t.actor))
    const minutes = new Map(computeMinutes(await listMatchEvents(t.db, t.matchId)).map((m) => [m.playerId, m.minutesPlayed]))
    expect(minutes.get(t.p(10))).toBe(70) // 0–10 y 30–90
    expect(minutes.get(t.p(12))).toBe(20) // 10–30
    expect(minutes.get(t.p(1))).toBe(90)
    expect(minutes.get(t.p(13)) ?? 0).toBe(0)
    // La proyección guardada coincide.
    expect((await t.db.playerMatchMinutes.get([t.matchId, t.p(10)]))?.minutesPlayed).toBe(70)
  })
})

describe('H/I/J · recarga, reconstrucción y cola de sincronización', () => {
  it('tras recargar, el estado y el reloj son los mismos; replay reconstruye el mismo estado', async () => {
    const t = await demoKickedOff()
    ok(await advanceTestClock(t.db, t.env, t.matchId, t.actor, 17 * MIN))
    await t.run({ type: 'SUBSTITUTE', outPlayerId: t.p(9), inPlayerId: t.p(13) })
    const before = await t.clock()

    const db = reopen(t.db)
    const events = await listMatchEvents(db, t.matchId)
    const match = (await db.matches.get(t.matchId))!
    const after = testClock(match, events, t.env)
    expect(after.matchNow).toBe(before.matchNow)
    expect(matchSecondAt(replay(t.matchId, events), after.matchNow)).toBe(17 * 60)
    expect(await loadMatchState(db, t.matchId)).toEqual(before.state)
    expect(await testModeActive(db, t.matchId)).toBe(true)

    // El reloj real sigue corriendo y el partido continúa desde ahí.
    t.env.wait(60)
    expect(ok(await advanceMatch(db, t.env, t.matchId, t.actor)).status).toBe('first_half')
    expect(matchSecondAt(await loadMatchState(db, t.matchId), testClock((await db.matches.get(t.matchId))!, events, t.env).matchNow)).toBe(18 * 60)
  })

  it('los eventos van a la cola normal (pendientes, seq consecutivos) y el modo pruebas nunca se sube', async () => {
    const t = await demoKickedOff()
    ok(await goToFullTime(t.db, t.env, t.matchId, t.actor))
    const events = await listMatchEvents(t.db, t.matchId)
    expect(events.every((e) => e.syncState === 'pending')).toBe(true)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    expect(await countPending(t.db)).toBeGreaterThanOrEqual(events.length)
    const { matchRow } = await import('../sync/mapping')
    expect(matchRow((await t.db.matches.get(t.matchId))!)).not.toHaveProperty('testMode')
  })
})
