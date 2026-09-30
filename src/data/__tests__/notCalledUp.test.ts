import { describe, expect, it } from 'vitest'
import { lineupOnField, sortPlayersByMinutes, type Id, type MatchCommand } from '../../domain'
import {
  advanceMatch,
  createMatch,
  goToFullTime,
  createPlayer,
  listPlayers,
  loadMatchState,
  runMatchCommand,
  saveSquad,
  seasonNotCalledUp,
  setTestMode,
  seasonPlayerTotals,
  type Actor,
} from '..'
import { fixture, lineupOf, reopen, type Fixture } from './testDb'

// "SIN CONVOCAR" con el motor y la base de datos local reales: solo partidos finalizados o
// guardados de la temporada, con la convocatoria definitiva (la congelada al pulsar PLAY).

const actorOf = (f: Fixture): Actor => ({ deviceId: f.scope.deviceId, coachId: f.coachId })

async function run(f: Fixture, matchId: Id, command: MatchCommand) {
  const result = await runMatchCommand(f.db, f.env, matchId, command, actorOf(f))
  if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
}

/** Partido nuevo de la temporada (o de otra), convocatoria guardada y jugado hasta `until`. */
async function playMatch(
  f: Fixture,
  squad: readonly Id[],
  options: { until?: 'setup' | 'first_half' | 'finished'; seasonId?: Id; beforePlay?: (matchId: Id) => Promise<void> } = {},
): Promise<Id> {
  const created = await createMatch(f.db, f.env, { teamId: f.scope.teamId, seasonId: options.seasonId ?? f.scope.seasonId }, {
    opponent: 'Rival',
    matchDate: null,
    kickoffTime: null,
    location: null,
  })
  if (!created.ok) throw new Error('partido')
  const matchId = created.value.id
  await saveSquad(f.db, f.env, matchId, squad, f.coachId)
  await options.beforePlay?.(matchId)
  await run(f, matchId, { type: 'START_SETUP' })
  if (options.until === 'setup') return matchId
  const current = (await f.db.matchSquads.get(matchId))!.playerIds
  await run(f, matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', current.slice(0, 11)) })
  await run(f, matchId, { type: 'START_MATCH' })
  if (options.until === 'first_half') return matchId
  f.env.wait(46 * 60)
  await advanceMatch(f.db, f.env, matchId, actorOf(f))
  await run(f, matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(await loadMatchState(f.db, matchId))! })
  f.env.wait(15)
  await run(f, matchId, { type: 'START_SECOND_HALF' })
  f.env.wait(46 * 60)
  await advanceMatch(f.db, f.env, matchId, actorOf(f))
  expect((await loadMatchState(f.db, matchId)).status).toBe('finished')
  f.env.wait(60)
  return matchId
}

async function history(f: Fixture, seasonId = f.scope.seasonId) {
  const players = await listPlayers(f.db, f.scope.teamId)
  const [totals, notCalledUp] = await Promise.all([seasonPlayerTotals(f.db, seasonId), seasonNotCalledUp(f.db, seasonId, players)])
  return { minutes: (id: Id) => totals.get(id)?.totalMinutes ?? 0, notCalled: (id: Id) => notCalledUp.get(id) ?? 0 }
}

describe('SIN CONVOCAR (temporada activa)', () => {
  it('1–3 · convocado con minutos: 0; convocado sin jugar: 0 (y 0 minutos); no convocado: 1', async () => {
    const f = await fixture()
    const squad = f.playerIds.slice(0, 14) // 15 y 16 fuera
    await playMatch(f, squad)
    const h = await history(f)
    expect([h.minutes(f.playerIds[0]!), h.notCalled(f.playerIds[0]!)]).toEqual([90, 0])
    expect([h.minutes(f.playerIds[13]!), h.notCalled(f.playerIds[13]!)]).toEqual([0, 0]) // convocado, suplente sin jugar
    expect([h.minutes(f.playerIds[14]!), h.notCalled(f.playerIds[14]!)]).toEqual([0, 1])
  })

  it('4 · tres partidos: no convocado en dos y convocado en uno → 2', async () => {
    const f = await fixture()
    const x = f.playerIds[15]!
    await playMatch(f, f.playerIds.slice(0, 14))
    await playMatch(f, [...f.playerIds.slice(0, 13), x])
    await playMatch(f, f.playerIds.slice(0, 14))
    expect((await history(f)).notCalled(x)).toBe(2)
  })

  it('5 · CONVOCAR A TODOS: nadie suma', async () => {
    const f = await fixture()
    await playMatch(f, f.playerIds) // todos los jugadores activos
    const h = await history(f)
    for (const id of f.playerIds) expect(h.notCalled(id)).toBe(0)
  })

  it('6 · no mezcla temporadas', async () => {
    const f = await fixture()
    const x = f.playerIds[15]!
    await f.db.seasons.put({ id: 'season-anterior', teamId: f.scope.teamId, name: '2025-26', updatedAt: f.env.now() })
    for (let i = 0; i < 3; i++) await playMatch(f, f.playerIds.slice(0, 14), { seasonId: 'season-anterior' })
    await playMatch(f, f.playerIds.slice(0, 14))
    expect((await history(f, 'season-anterior')).notCalled(x)).toBe(3)
    expect((await history(f)).notCalled(x)).toBe(1)
  })

  it('7 · un jugador dado de alta después no cuenta los partidos anteriores', async () => {
    const f = await fixture()
    await playMatch(f, f.playerIds.slice(0, 14))
    f.env.wait(3600)
    const created = await createPlayer(f.db, f.env, f.scope.teamId, { name: 'Nuevo', number: 30 })
    if (!created.ok) throw new Error('jugador')
    expect((await history(f)).notCalled(created.value.id)).toBe(0)
    await playMatch(f, f.playerIds.slice(0, 14))
    expect((await history(f)).notCalled(created.value.id)).toBe(1)
  })

  it('8 · convocatoria editada antes de PLAY: cuenta solo la definitiva; después de PLAY no se puede cambiar', async () => {
    const f = await fixture()
    const x = f.playerIds[15]!
    const matchId = await playMatch(f, f.playerIds.slice(0, 14), {
      // Primero sin X, después se corrige y X entra (varias ediciones = una sola decisión).
      beforePlay: async (id) => {
        await saveSquad(f.db, f.env, id, f.playerIds.slice(0, 13), f.coachId)
        await saveSquad(f.db, f.env, id, [...f.playerIds.slice(0, 14), x], f.coachId)
      },
    })
    expect((await history(f)).notCalled(x)).toBe(0)
    expect((await saveSquad(f.db, f.env, matchId, [], f.coachId)).ok).toBe(false) // bloqueada
    expect((await history(f)).notCalled(x)).toBe(0)
  })

  it('9 · partidos no definitivos (preparación, en juego) no cuentan', async () => {
    const f = await fixture()
    const x = f.playerIds[15]!
    await playMatch(f, f.playerIds.slice(0, 14), { until: 'setup' })
    await playMatch(f, f.playerIds.slice(0, 14), { until: 'first_half' })
    expect((await history(f)).notCalled(x)).toBe(0)
  })

  it('10 · tras recargar, el mismo resultado', async () => {
    const f = await fixture()
    await playMatch(f, f.playerIds.slice(0, 14))
    const before = await history(f)
    const db = reopen(f.db)
    const players = await listPlayers(db, f.scope.teamId)
    const after = await seasonNotCalledUp(db, f.scope.seasonId, players)
    for (const id of f.playerIds) expect(after.get(id) ?? 0).toBe(before.notCalled(id))
  })

  it('11 · partidos de otro equipo (su temporada) no cuentan', async () => {
    const f = await fixture()
    const x = f.playerIds[15]!
    await playMatch(f, f.playerIds.slice(0, 14), { seasonId: 'season-de-otro-equipo' })
    expect((await history(f)).notCalled(x)).toBe(0)
  })

  it('12 · el orden sigue siendo minutos y, a igualdad, dorsal como número', async () => {
    const f = await fixture()
    await playMatch(f, f.playerIds.slice(0, 14))
    const players = (await listPlayers(f.db, f.scope.teamId)).filter((p) => p.active)
    const sorted = sortPlayersByMinutes(players, await seasonPlayerTotals(f.db, f.scope.seasonId))
    // 11 titulares (90'), después los tres suplentes y los dos no convocados (0'), por dorsal.
    expect(sorted.slice(11).map((p) => p.number)).toEqual([12, 13, 14, 15, 16])
    expect(sorted.slice(0, 11).map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('13 · MODO PRUEBAS (PLAY fechado 3 h atrás): cuenta igual, con la hora real de la decisión', async () => {
    const f = await fixture()
    await f.db.teams.update(f.scope.teamId, { name: 'DEMO' })
    const x = f.playerIds[15]!
    const matchId = await playMatch(f, f.playerIds.slice(0, 14), {
      until: 'first_half',
      beforePlay: async (id) => {
        const enabled = await setTestMode(f.db, f.env, id, true)
        if (!enabled.ok) throw new Error('modo pruebas')
      },
    })
    const finished = await goToFullTime(f.db, f.env, matchId, actorOf(f))
    expect(finished.ok && finished.value.status).toBe('finished')
    const h = await history(f)
    expect(h.notCalled(x)).toBe(1)
    expect(h.notCalled(f.playerIds[0]!)).toBe(0)
  })
})
