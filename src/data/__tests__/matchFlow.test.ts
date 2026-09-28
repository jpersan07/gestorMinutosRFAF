import { describe, expect, it } from 'vitest'
import { lineupOnField, secondHalfAvailableAt, type Id, type MatchCommand } from '../../domain'
import {
  advanceMatch,
  findActiveMatchId,
  getLineupDraft,
  getSquad,
  listMatchEvents,
  loadMatchState,
  runMatchCommand,
  saveLineupDraft,
  saveMatch,
  saveReport,
  saveSquad,
  seasonPlayerTotals,
  updateMatchDetails,
  type Actor,
} from '..'
import { fixture, lineupOf, reopen, type Fixture } from './testDb'

async function must(f: Fixture, command: MatchCommand, actor?: Actor) {
  const result = await runMatchCommand(f.db, f.env, f.matchId, command, actor ?? actorOf(f))
  if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.error)}`)
  return result.value
}

const actorOf = (f: Fixture): Actor => ({ deviceId: f.scope.deviceId, coachId: f.coachId })

/** Partido con convocatoria (16), 4-3-3 con los 11 primeros y PLAY pulsado. */
async function kickedOff() {
  const f = await fixture()
  await saveSquad(f.db, f.env, f.matchId, f.playerIds, f.coachId)
  await must(f, { type: 'START_SETUP' })
  await must(f, { type: 'CONFIRM_LINEUP', lineup: lineupOf('4-3-3', f.playerIds.slice(0, 11)) })
  await must(f, { type: 'START_MATCH' })
  return f
}

describe('convocatoria', () => {
  it('se guarda asociada al partido, sin duplicados ni jugadores inexistentes', async () => {
    const f = await fixture()
    const [a, b] = f.playerIds
    const result = await saveSquad(f.db, f.env, f.matchId, [a!, b!, a!, 'no-existe'], f.coachId)
    expect(result).toMatchObject({ ok: true, value: { playerIds: [a, b] } })
    expect(await getSquad(f.db, f.matchId)).toEqual([a, b])
  })

  it('se puede editar antes del partido y queda bloqueada al pulsar PLAY', async () => {
    const f = await kickedOff()
    expect(await saveSquad(f.db, f.env, f.matchId, f.playerIds.slice(0, 12), f.coachId)).toEqual({
      ok: false,
      error: { code: 'LOCKED' },
    })
  })
})

describe('partido completo sobre IndexedDB', () => {
  it('recorre el flujo y mantiene la caché del partido y la proyección de minutos', async () => {
    const f = await kickedOff()
    const { db, env, matchId, playerIds } = f
    const p = (n: number) => playerIds[n - 1]!

    expect((await db.matches.get(matchId))?.status).toBe('first_half')
    expect((await db.matches.get(matchId))?.managedBy).toBe(f.coachId)

    env.wait(30 * 60)
    await must(f, { type: 'SUBSTITUTE', outPlayerId: p(10), inPlayerId: p(12) })

    env.wait(20 * 60) // 50:00 real: la parte terminó en 45:00
    const atHalftime = await advanceMatch(db, env, matchId, actorOf(f))
    expect(atHalftime).toMatchObject({ ok: true, value: { status: 'halftime' } })
    expect((await db.matches.get(matchId))?.status).toBe('halftime')

    const state = await loadMatchState(db, matchId)
    await must(f, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(state)! })
    env.time = Math.max(env.time, secondHalfAvailableAt(state)!)
    await must(f, { type: 'START_SECOND_HALF' })
    env.wait(12 * 60 + 42) // 57:42
    await must(f, { type: 'SUBSTITUTE', outPlayerId: p(9), inPlayerId: p(13) })
    env.wait(60 * 60)
    await advanceMatch(db, env, matchId, actorOf(f))

    expect((await db.matches.get(matchId))?.status).toBe('finished')
    const minutes = Object.fromEntries(
      (await db.playerMatchMinutes.where('matchId').equals(matchId).toArray()).map((r) => [r.playerId, r.minutesPlayed]),
    )
    expect(minutes).toMatchObject({ [p(1)]: 90, [p(10)]: 30, [p(12)]: 60, [p(9)]: 57, [p(13)]: 33, [p(16)]: 0 })

    // Guardar exige RESULTADO.
    expect(await saveMatch(db, env, matchId, actorOf(f))).toEqual({ ok: false, error: { code: 'RESULT_REQUIRED' } })
    await saveReport(db, env, matchId, { result: '3-1', observations: '' }, f.coachId)
    expect(await saveMatch(db, env, matchId, actorOf(f))).toMatchObject({ ok: true, value: { status: 'saved' } })
    const saved = await db.matches.get(matchId)
    expect(saved).toMatchObject({ status: 'saved' })
    expect(saved?.savedAt).toBe(env.time)

    // Solo lectura.
    expect(await saveReport(db, env, matchId, { result: '4-1', observations: '' }, f.coachId)).toEqual({
      ok: false,
      error: { code: 'LOCKED' },
    })
    expect(
      await updateMatchDetails(db, env, matchId, { opponent: 'X', matchDate: null, kickoffTime: null, location: null }),
    ).toEqual({ ok: false, error: { code: 'LOCKED' } })
    expect(await runMatchCommand(db, env, matchId, { type: 'START_SETUP' }, actorOf(f))).toEqual({
      ok: false,
      error: { code: 'MATCH_LOCKED' },
    })
  })

  it('el informe solo se puede escribir con el partido finalizado', async () => {
    const f = await kickedOff()
    expect(await saveReport(f.db, f.env, f.matchId, { result: '1-0', observations: '' }, f.coachId)).toEqual({
      ok: false,
      error: { code: 'LOCKED' },
    })
  })

  it('EDITAR queda bloqueado al pulsar PLAY', async () => {
    const f = await kickedOff()
    expect(
      await updateMatchDetails(f.db, f.env, f.matchId, { opponent: 'X', matchDate: null, kickoffTime: null, location: null }),
    ).toEqual({ ok: false, error: { code: 'LOCKED' } })
  })

  it('un comando rechazado no escribe nada salvo los finales automáticos vencidos', async () => {
    const f = await kickedOff()
    const before = await f.db.matchEvents.count()
    const bad = await runMatchCommand(
      f.db,
      f.env,
      f.matchId,
      { type: 'SUBSTITUTE', outPlayerId: 'x', inPlayerId: 'y' },
      actorOf(f),
    )
    expect(bad.ok).toBe(false)
    expect(await f.db.matchEvents.count()).toBe(before)

    f.env.wait(46 * 60)
    const late = await runMatchCommand(
      f.db,
      f.env,
      f.matchId,
      { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! },
      actorOf(f),
    )
    expect(late).toMatchObject({ ok: false, error: { code: 'INVALID_TRANSITION' } })
    expect((await listMatchEvents(f.db, f.matchId)).at(-1)?.type).toBe('HALF_ENDED')
    expect((await f.db.matches.get(f.matchId))?.status).toBe('halftime')
  })

  it('otro dispositivo no puede modificar el partido', async () => {
    const f = await kickedOff()
    const result = await runMatchCommand(
      f.db,
      f.env,
      f.matchId,
      { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! },
      { deviceId: 'otro-movil', coachId: f.coachId },
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_CONTROLLER' } })
  })
})

describe('concurrencia', () => {
  it('final automático y cambio pulsado a la vez: una sola historia, sin seq duplicados', async () => {
    const f = await kickedOff()
    f.env.wait(45 * 60)
    await Promise.all([
      advanceMatch(f.db, f.env, f.matchId, actorOf(f)),
      runMatchCommand(
        f.db,
        f.env,
        f.matchId,
        { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! },
        actorOf(f),
      ),
      advanceMatch(f.db, f.env, f.matchId, actorOf(f)),
    ])
    const events = await listMatchEvents(f.db, f.matchId)
    expect(events.filter((e) => e.type === 'HALF_ENDED')).toHaveLength(1)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
  })

  it('la base de datos rechaza dos eventos con el mismo seq', async () => {
    const f = await kickedOff()
    const [first] = await listMatchEvents(f.db, f.matchId)
    await expect(f.db.matchEvents.add({ ...first!, id: 'otro-id' })).rejects.toThrow()
  })
})

describe('recuperación tras cerrar la app', () => {
  it('reabre la base de datos y reconstruye el mismo estado; encuentra el partido en juego', async () => {
    const f = await kickedOff()
    f.env.wait(20 * 60)
    await must(f, { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! })
    const before = await loadMatchState(f.db, f.matchId)

    const db = reopen(f.db)
    expect(await loadMatchState(db, f.matchId)).toEqual(before)
    expect(await findActiveMatchId(db, f.scope.deviceId)).toBe(f.matchId)
    expect(await findActiveMatchId(db, 'otro-movil')).toBeNull()
  })

  it('cerrada durante el final de la 1ª parte: al reabrir, advanceMatch deja el descanso con la hora exacta', async () => {
    const f = await kickedOff()
    const kickOffAt = (await loadMatchState(f.db, f.matchId)).halfStartedAt[1]!
    const db = reopen(f.db)
    f.env.wait(70 * 60)
    const result = await advanceMatch(db, f.env, f.matchId, actorOf(f))
    expect(result).toMatchObject({ ok: true, value: { status: 'halftime' } })
    const halfEnded = (await listMatchEvents(db, f.matchId)).at(-1)
    expect(halfEnded).toMatchObject({ type: 'HALF_ENDED', occurredAt: kickOffAt + 45 * 60_000 })
  })

  it('los borradores de alineación sobreviven a una recarga', async () => {
    const f = await fixture()
    const draft = lineupOf('5-3-2', f.playerIds.slice(0, 4))
    await saveLineupDraft(f.db, f.env, f.matchId, 1, draft)
    expect(await getLineupDraft(reopen(f.db), f.matchId, 1)).toEqual(draft)
  })
})

describe('minutos acumulados de la temporada', () => {
  it('suman los partidos finalizados de la temporada desde la proyección de eventos', async () => {
    const f = await kickedOff()
    f.env.wait(10 * 60)
    await must(f, { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! })
    f.env.wait(40 * 60)
    await advanceMatch(f.db, f.env, f.matchId, actorOf(f))

    // En el descanso todavía no cuenta: solo partidos finalizados.
    expect((await seasonPlayerTotals(f.db, f.scope.seasonId)).size).toBe(0)

    const state = await loadMatchState(f.db, f.matchId)
    await must(f, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(state)! })
    f.env.wait(15)
    await must(f, { type: 'START_SECOND_HALF' })
    f.env.wait(45 * 60)
    await advanceMatch(f.db, f.env, f.matchId, actorOf(f))

    const totals = await seasonPlayerTotals(f.db, f.scope.seasonId)
    const get = (id: Id) => totals.get(id)
    expect(get(f.playerIds[9]!)).toMatchObject({ totalMinutes: 10, starts: 1, callUps: 1 })
    expect(get(f.playerIds[11]!)).toMatchObject({ totalMinutes: 80, starts: 0 })
    expect(get(f.playerIds[15]!)).toMatchObject({ totalMinutes: 0, callUps: 1, matchesPlayed: 0 })
  })
})
