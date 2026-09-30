import { describe, expect, it } from 'vitest'
import { benchPlayers, lineupOnField, matchSecondAt, replay, type Id, type MatchCommand } from '../../domain'
import { substitutionCandidates } from '../../app/match/substitutionCandidates'
import {
  advanceMatch,
  createMatch,
  listMatchEvents,
  listPlayers,
  loadMatchState,
  runMatchCommand,
  saveMatch,
  saveReport,
  saveSquad,
  seasonPlayerTotals,
  type Actor,
} from '..'
import { fixture, lineupOf, reopen, type Fixture } from './testDb'

// Ventana CAMBIO con la base de datos local y el motor reales: minutos de ESTE partido · de la
// TEMPORADA (partidos finalizados o guardados). El partido en juego nunca se cuenta dos veces.

const actorOf = (f: Fixture): Actor => ({ deviceId: f.scope.deviceId, coachId: f.coachId })
const MIN = 60_000

async function run(f: Fixture, matchId: Id, command: MatchCommand) {
  const result = await runMatchCommand(f.db, f.env, matchId, command, actorOf(f))
  if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
}

/** Histórico sintético: un partido ya finalizado de esa temporada con minutos dados. */
async function pastMatch(f: Fixture, seasonId: Id, minutes: ReadonlyArray<readonly [Id, number]>) {
  const created = await createMatch(f.db, f.env, { teamId: f.scope.teamId, seasonId }, {
    opponent: 'Anterior',
    matchDate: null,
    kickoffTime: null,
    location: null,
  })
  if (!created.ok) throw new Error('partido')
  await f.db.matches.update(created.value.id, { status: 'finished' })
  await f.db.playerMatchMinutes.bulkPut(
    minutes.map(([playerId, m]) => ({
      matchId: created.value.id,
      playerId,
      secondsPlayed: m * 60,
      minutesPlayed: m,
      started: true,
      syncState: 'synced' as const,
    })),
  )
}

async function candidates(f: Fixture, matchId: Id, db = f.db) {
  const state = await loadMatchState(db, matchId)
  const players = new Map((await listPlayers(db, f.scope.teamId)).map((p) => [p.id, p]))
  const now = f.env.now()
  return substitutionCandidates(
    benchPlayers(state).flatMap((id) => players.get(id) ?? []),
    await listMatchEvents(db, matchId),
    matchSecondAt(state, now),
    await seasonPlayerTotals(db, f.scope.seasonId),
  )
}

describe('ventana CAMBIO con el histórico real de la temporada', () => {
  it('Jugador A: 321′ antes; entra en el 63′ y juega 27′ → durante el partido 27′ · 321′; al terminar, 348′ una sola vez', async () => {
    const f = await fixture()
    const a = f.playerIds[11]! // dorsal 12, suplente
    await pastMatch(f, f.scope.seasonId, [[a, 321]])
    await pastMatch(f, 'otra-temporada', [[a, 100]]) // otra temporada (u otro equipo): no cuenta

    await saveSquad(f.db, f.env, f.matchId, f.playerIds.slice(0, 14), f.coachId)
    await run(f, f.matchId, { type: 'START_SETUP' })
    await run(f, f.matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', f.playerIds.slice(0, 11)) })
    await run(f, f.matchId, { type: 'START_MATCH' })
    f.env.wait(20 * 60)
    const at20 = (await candidates(f, f.matchId)).find((c) => c.player.id === a)!
    expect([at20.matchMinutes, at20.seasonMinutes]).toEqual([0, 321])

    f.env.wait(26 * 60)
    await advanceMatch(f.db, f.env, f.matchId, actorOf(f))
    await run(f, f.matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(await loadMatchState(f.db, f.matchId))! })
    f.env.wait(15)
    await run(f, f.matchId, { type: 'START_SECOND_HALF' })
    f.env.wait(18 * 60) // 63′
    const at63 = (await candidates(f, f.matchId)).find((c) => c.player.id === a)!
    expect([at63.matchMinutes, at63.seasonMinutes]).toEqual([0, 321])
    await run(f, f.matchId, { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: a })

    // A punto de acabar (89:59): 26′ en el partido; la temporada sigue en 321 (partido en juego).
    f.env.wait(27 * 60 - 1)
    expect((await seasonPlayerTotals(f.db, f.scope.seasonId)).get(a)?.totalMinutes).toBe(321)
    f.env.wait(1)
    await advanceMatch(f.db, f.env, f.matchId, actorOf(f))
    expect((await loadMatchState(f.db, f.matchId)).status).toBe('finished')
    expect((await seasonPlayerTotals(f.db, f.scope.seasonId)).get(a)?.totalMinutes).toBe(348)

    // Guardar no lo vuelve a sumar.
    await saveReport(f.db, f.env, f.matchId, { result: '1-0', observations: '' }, f.coachId)
    const saved = await saveMatch(f.db, f.env, f.matchId, actorOf(f))
    expect(saved.ok && saved.value.status).toBe('saved')
    expect((await seasonPlayerTotals(f.db, f.scope.seasonId)).get(a)?.totalMinutes).toBe(348)
  })

  it('jugador que salió y vuelve a poder entrar: sus minutos del partido no empiezan de cero; tras recargar, igual', async () => {
    const f = await fixture()
    const b = f.playerIds[9]! // dorsal 10, titular
    await pastMatch(f, f.scope.seasonId, [[b, 250]])
    await saveSquad(f.db, f.env, f.matchId, f.playerIds.slice(0, 14), f.coachId)
    await run(f, f.matchId, { type: 'START_SETUP' })
    await run(f, f.matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', f.playerIds.slice(0, 11)) })
    await run(f, f.matchId, { type: 'START_MATCH' })
    f.env.wait(20 * 60)
    await run(f, f.matchId, { type: 'SUBSTITUTE', outPlayerId: b, inPlayerId: f.playerIds[11]! }) // sale en el 20
    f.env.wait(15 * MIN / 1000)
    const row = (await candidates(f, f.matchId)).find((c) => c.player.id === b)!
    expect([row.matchMinutes, row.seasonMinutes]).toEqual([20, 250])

    const before = await loadMatchState(f.db, f.matchId)
    const db = reopen(f.db)
    const again = (await candidates(f, f.matchId, db)).find((c) => c.player.id === b)!
    expect([again.matchMinutes, again.seasonMinutes]).toEqual([20, 250])
    // Replay: mismo estado.
    expect(replay(f.matchId, await listMatchEvents(db, f.matchId))).toEqual(before)
  })
})
