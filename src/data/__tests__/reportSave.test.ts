import { describe, expect, it } from 'vitest'
import { lineupOnField, type Id, type MatchCommand } from '../../domain'
import {
  advanceMatch,
  applyTeamContext,
  countPending,
  createMatch,
  createPlayer,
  listMatchEvents,
  loadMatchState,
  runMatchCommand,
  saveMatch,
  saveReport,
  saveSquad,
  ServerClock,
  syncOnce,
  updateMatchDetails,
  updatePlayer,
  type AppDatabase,
} from '..'
import { FakeServer } from './fakeServer'
import { fixture, lineupOf, openTestDb, reopen, TEST_TEAM_CONTEXT } from './testDb'

// Guardar el partido nunca pierde el informe (bug de 30/09/2026):
//   1. MATCH_SAVED bloquea el partido en el servidor: el informe y los minutos tienen que estar
//      ACEPTADOS antes de subirlo;
//   2. la versión de cada edición nunca va hacia atrás, aunque la hora del móvil o su corrección
//      con la del servidor cambien.

const MIN = 60_000
const HOUR = 60 * MIN

/** Un móvil con la corrección de hora de la app sobre un reloj que se puede desajustar. */
async function phone(server: FakeServer, userId: Id, name: string, db: AppDatabase = openTestDb()) {
  const device = { skewMs: 0 }
  const clock = new ServerClock(() => server.time + device.skewMs)
  let next = 0
  const env = clock.env(() => `${name}-${String(++next).padStart(4, '0')}`)
  const scope = await applyTeamContext(db, env, userId, TEST_TEAM_CONTEXT)
  const context = { db, supabase: server.supabase(userId), remote: server.remote(userId), scope, clock }
  const actor = { deviceId: scope.deviceId, coachId: userId }
  return {
    db,
    env,
    device,
    scope,
    actor,
    sync: () => syncOnce(context),
    run: async (matchId: Id, command: MatchCommand) => {
      const result = await runMatchCommand(db, env, matchId, command, actor)
      if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
      return result.value
    },
    report: async (matchId: Id, result: string, observations: string) => {
      const saved = await saveReport(db, env, matchId, { result, observations }, userId)
      if (!saved.ok) throw new Error(JSON.stringify(saved.error))
      return saved.value
    },
  }
}
type Phone = Awaited<ReturnType<typeof phone>>

/** A juega un partido completo (todo subido) hasta PARTIDO FINALIZADO. */
async function finishedMatch() {
  const server = new FakeServer(TEST_TEAM_CONTEXT.team.id)
  const a = await phone(server, 'user-isaac', 'A')
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
  await a.run(matchId, { type: 'START_SETUP' })
  await a.run(matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', players.slice(0, 11)) })
  await a.run(matchId, { type: 'START_MATCH' })
  server.time += 45 * MIN
  await advanceMatch(a.db, a.env, matchId, a.actor)
  await a.run(matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(await loadMatchState(a.db, matchId))! })
  server.time += 15_000
  await a.run(matchId, { type: 'START_SECOND_HALF' })
  server.time += 46 * MIN
  expect((await advanceMatch(a.db, a.env, matchId, a.actor)).ok).toBe(true)
  expect((await loadMatchState(a.db, matchId)).status).toBe('finished')
  expect((await a.sync()).ok).toBe(true)
  expect(server.row('matches', matchId)?.status).toBe('finished')
  return { server, a, matchId }
}

/** Resultado subido (como el guardado automático al escribirlo) y observaciones justo después. */
async function resultUploadedThenObservations(a: Phone, matchId: Id) {
  await a.report(matchId, '3-1', '')
  expect((await a.sync()).ok).toBe(true)
  await a.report(matchId, '3-1', 'Buen partido.\nLesión leve de Jugador 5.')
  expect((await saveMatch(a.db, a.env, matchId, a.actor)).ok).toBe(true)
}

async function expectSavedWithReport(server: FakeServer, a: Phone, matchId: Id) {
  expect(server.row('matches', matchId)?.status).toBe('saved')
  expect(server.row('match_reports', matchId)).toMatchObject({
    result: '3-1',
    observations: 'Buen partido.\nLesión leve de Jugador 5.',
  })
  expect(await a.db.matchReports.get(matchId)).toMatchObject({
    result: '3-1',
    observations: 'Buen partido.\nLesión leve de Jugador 5.',
    syncState: 'synced',
  })
  // Ni un evento de más: los reintentos no duplican nada.
  const local = await listMatchEvents(a.db, matchId)
  expect(server.eventsOf(matchId).map((e) => e.id)).toEqual(local.map((e) => e.id))
  expect(local.every((e) => e.syncState === 'synced')).toBe(true)
  expect(await countPending(a.db)).toBe(0)
}

const isSave = (request: string) => request.startsWith('rpc:') && request.includes('MATCH_SAVED')

describe('guardar el partido nunca pierde el informe', () => {
  it('A · guardado rápido: resultado ya subido, observaciones y GUARDAR enseguida → el servidor tiene las dos cosas', async () => {
    const { server, a, matchId } = await finishedMatch()
    await resultUploadedThenObservations(a, matchId)
    expect((await a.sync()).ok).toBe(true)
    await expectSavedWithReport(server, a, matchId)
  })

  it('B · el informe y los minutos se CONFIRMAN antes de enviar MATCH_SAVED', async () => {
    const { server, a, matchId } = await finishedMatch()
    await resultUploadedThenObservations(a, matchId)
    const atSave: unknown[] = []
    server.onRequest = (request, phase) => {
      if (phase === 'before' && isSave(request)) atSave.push(server.row('match_reports', matchId)?.observations)
    }
    const before = server.requests.length
    expect((await a.sync()).ok).toBe(true)

    const requests = server.requests.slice(before)
    const save = requests.findIndex(isSave)
    expect(save).toBeGreaterThan(requests.indexOf('upsert:match_reports'))
    expect(save).toBeGreaterThan(requests.indexOf('upsert:player_match_minutes'))
    expect(requests.indexOf('upsert:match_reports')).toBeGreaterThanOrEqual(0)
    // Cuando llega MATCH_SAVED, el servidor YA tiene las observaciones.
    expect(atSave).toEqual(['Buen partido.\nLesión leve de Jugador 5.'])
    await expectSavedWithReport(server, a, matchId)
  })

  it('C · red perdida entre el informe (aceptado) y MATCH_SAVED → reconexión, recarga y reintento', async () => {
    const { server, a, matchId } = await finishedMatch()
    await resultUploadedThenObservations(a, matchId)
    server.onRequest = (request, phase) => {
      if (phase === 'before' && isSave(request)) server.offline = true
    }
    expect((await a.sync()).ok).toBe(false)
    // Informe aceptado; el partido sigue sin guardar en el servidor y MATCH_SAVED, pendiente.
    expect(server.row('match_reports', matchId)?.observations).toBe('Buen partido.\nLesión leve de Jugador 5.')
    expect(server.row('matches', matchId)?.status).toBe('finished')
    expect(server.eventsOf(matchId).some((e) => e.event_type === 'MATCH_SAVED')).toBe(false)
    const saved = (await listMatchEvents(a.db, matchId)).find((e) => e.type === 'MATCH_SAVED')
    expect(saved?.syncState).toBe('pending')

    // Reconexión y recarga del móvil.
    server.offline = false
    server.onRequest = null
    const again = await phone(server, 'user-isaac', 'A', reopen(a.db))
    expect((await again.sync()).ok).toBe(true)
    await expectSavedWithReport(server, again, matchId)
  })

  it('C · red perdida ANTES de subir el informe → MATCH_SAVED no se envía; al reconectar, todo en orden', async () => {
    const { server, a, matchId } = await finishedMatch()
    await resultUploadedThenObservations(a, matchId)
    server.onRequest = (request, phase) => {
      if (phase === 'before' && request === 'upsert:match_reports') server.offline = true
    }
    expect((await a.sync()).ok).toBe(false)
    expect(server.requests.some(isSave)).toBe(false)
    expect(server.row('matches', matchId)?.status).toBe('finished')
    expect(server.row('match_reports', matchId)?.observations).toBe('')
    expect((await a.db.matchReports.get(matchId))?.syncState).toBe('pending')

    server.offline = false
    server.onRequest = null
    expect((await a.sync()).ok).toBe(true)
    await expectSavedWithReport(server, a, matchId)
  })

  it('C · red perdida DESPUÉS de MATCH_SAVED (respuesta perdida) → el reenvío es idempotente', async () => {
    const { server, a, matchId } = await finishedMatch()
    await resultUploadedThenObservations(a, matchId)
    server.onRequest = (request, phase) => {
      if (phase === 'after' && isSave(request)) server.offline = true
    }
    expect((await a.sync()).ok).toBe(false)
    expect(server.row('matches', matchId)?.status).toBe('saved')
    expect((await listMatchEvents(a.db, matchId)).find((e) => e.type === 'MATCH_SAVED')?.syncState).toBe('pending')

    server.offline = false
    server.onRequest = null
    const again = await phone(server, 'user-isaac', 'A', reopen(a.db))
    expect((await again.sync()).ok).toBe(true)
    await expectSavedWithReport(server, again, matchId)
  })

  it('F · otro móvil descarga el estado oficial: mismo estado, mismos eventos y el mismo informe', async () => {
    const { server, a, matchId } = await finishedMatch()
    await resultUploadedThenObservations(a, matchId)
    expect((await a.sync()).ok).toBe(true)

    const b = await phone(server, 'user-jordi', 'B')
    expect((await b.sync()).ok).toBe(true)
    expect((await loadMatchState(b.db, matchId)).status).toBe('saved')
    expect((await listMatchEvents(b.db, matchId)).map((e) => e.id)).toEqual(
      (await listMatchEvents(a.db, matchId)).map((e) => e.id),
    )
    const reportA = (await a.db.matchReports.get(matchId))!
    expect(await b.db.matchReports.get(matchId)).toMatchObject({
      result: reportA.result,
      observations: reportA.observations,
      updatedAt: reportA.updatedAt,
      syncState: 'synced',
    })
    // Y A, tras otra sincronización, sigue igual.
    expect((await a.sync()).ok).toBe(true)
    expect(await a.db.matchReports.get(matchId)).toEqual(reportA)
  })
})

describe('la versión de una edición nunca va hacia atrás', () => {
  it('D · la corrección de hora cambia entre dos ediciones: la segunda NO se pierde', async () => {
    const { server, a, matchId } = await finishedMatch()
    // El reloj del móvil se adelanta 1 h (la corrección aún no lo sabe): edición 1 con hora T+1h.
    a.device.skewMs = HOUR
    const first = await a.report(matchId, '3-1', '')
    expect((await a.sync()).ok).toBe(true) // la sincronización vuelve a medir la corrección
    expect(server.row('match_reports', matchId)?.result).toBe('3-1')
    expect(a.env.now()).toBeLessThan(first.updatedAt) // la hora corregida ha ido hacia atrás

    // Edición 2: hora corregida MENOR que la de la edición 1 → versión posterior igualmente.
    const second = await a.report(matchId, '3-1', 'Buen partido.\nLesión leve de Jugador 5.')
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
    expect((await saveMatch(a.db, a.env, matchId, a.actor)).ok).toBe(true)
    expect((await a.sync()).ok).toBe(true)
    await expectSavedWithReport(server, a, matchId)
  })

  it('E · varias ediciones seguidas (en el mismo milisegundo): versiones crecientes y gana la última', async () => {
    const { server, a, matchId } = await finishedMatch()
    const versions: number[] = []
    for (const text of ['B', 'Bu', 'Bue', 'Buen', 'Buen partido.']) {
      versions.push((await a.report(matchId, '3-1', text)).updatedAt)
      if (text === 'Bue') expect((await a.sync()).ok).toBe(true) // una subida a mitad
    }
    expect(versions).toEqual([...versions].sort((x, y) => x - y))
    expect(new Set(versions).size).toBe(versions.length)
    expect((await a.sync()).ok).toBe(true)
    expect(server.row('match_reports', matchId)?.observations).toBe('Buen partido.')
    expect(await a.db.matchReports.get(matchId)).toMatchObject({ observations: 'Buen partido.', syncState: 'synced' })
  })

  it('D · jugadores, datos del partido y convocatoria: la edición posterior tiene versión posterior', async () => {
    const f = await fixture()
    const player = (await f.db.players.get(f.playerIds[0]!))!
    const match = (await f.db.matches.get(f.matchId))!
    await saveSquad(f.db, f.env, f.matchId, f.playerIds.slice(0, 14), f.coachId)
    const squad = (await f.db.matchSquads.get(f.matchId))!

    f.env.time -= HOUR // la hora corregida va hacia atrás
    const edited = await updatePlayer(f.db, f.env, player.id, { name: 'Renombrado', number: player.number, active: true })
    const details = await updateMatchDetails(f.db, f.env, f.matchId, { opponent: 'CD Ronda', matchDate: null, kickoffTime: null, location: null })
    const squadAgain = await saveSquad(f.db, f.env, f.matchId, f.playerIds.slice(0, 12), f.coachId)
    if (!edited.ok || !details.ok || !squadAgain.ok) throw new Error('edición')
    expect(edited.value.updatedAt).toBeGreaterThan(player.updatedAt)
    expect(details.value.detailsUpdatedAt).toBeGreaterThan(match.detailsUpdatedAt!)
    expect(squadAgain.value.updatedAt).toBeGreaterThan(squad.updatedAt)

    // Con la hora bien, la versión es la hora (no se inventa nada).
    f.env.time += 2 * HOUR
    const later = await updatePlayer(f.db, f.env, player.id, { name: 'Otra vez', number: player.number, active: true })
    if (!later.ok) throw new Error('edición')
    expect(later.value.updatedAt).toBe(f.env.time)
  })
})
