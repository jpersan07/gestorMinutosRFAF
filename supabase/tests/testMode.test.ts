import { beforeAll, describe, expect, it } from 'vitest'
import {
  advanceTestClock,
  goToFullTime,
  listMatchEvents,
  saveMatch,
  saveReport,
} from '../../src/data'
import { computeMinutes } from '../../src/domain'
import { createTeam, createUser, must, serviceClient } from './helpers'
import { coachInTeam, MIN, phone, preparedLocally, shape, sub } from './phones'

// MODO PRUEBAS (equipo DEMO) contra el Supabase LOCAL con la tolerancia REAL de horas futuras
// (60 s): el partido acelerado se valida y se sincroniza como cualquier otro.

beforeAll(async () => {
  expect(must(await serviceClient().rpc('set_event_time_policy', { p_max_future_ms: 60_000 })).data).toBe(60_000)
})

describe('modo pruebas contra el servidor real', () => {
  it('partido completo acelerado: el servidor acepta todo, nada queda pendiente y otro móvil lo reconstruye igual', async () => {
    const isaac = await createUser('Isaac')
    const team = await createTeam([{ user: isaac, role: 'admin' }], 'DEMO')
    // Como la app: reloj corregido con la hora del servidor.
    const a = await phone(isaac, team, { skewMs: 0 })
    await a.sync()
    const { players, matchId } = await preparedLocally(a, { testMode: true })

    const ok = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }) => {
      if (!result.ok) throw new Error(JSON.stringify(result.error))
      return result.value
    }
    ok(await advanceTestClock(a.db, a.env, matchId, a.actor, 10 * MIN))
    await a.run(matchId, sub(players, 10, 12))
    ok(await advanceTestClock(a.db, a.env, matchId, a.actor, 20 * MIN))
    await a.run(matchId, sub(players, 12, 10)) // reentrada
    expect(ok(await goToFullTime(a.db, a.env, matchId, a.actor)).status).toBe('finished')
    ok(await saveReport(a.db, a.env, matchId, { result: '1-0', observations: 'Modo pruebas' }, isaac.id))
    ok(await saveMatch(a.db, a.env, matchId, a.actor))

    const report = await a.sync()
    expect(report.ok).toBe(true)
    expect(report.push.quarantined).toBe(0)
    const local = await listMatchEvents(a.db, matchId)
    expect(local.every((e) => e.syncState === 'synced')).toBe(true)
    expect(await a.db.rejectedEvents.count()).toBe(0)

    const server = must(await isaac.client.from('matches').select('status, last_seq').eq('id', matchId).single()).data!
    expect(server).toEqual({ status: 'saved', last_seq: local.length })
    // Ningún evento en el futuro respecto a la hora del servidor.
    const times = must(await isaac.client.from('match_events').select('occurred_at').eq('match_id', matchId)).data!
    const serverNow = Number(must(await isaac.client.rpc('server_time')).data)
    for (const { occurred_at } of times) expect(Date.parse(occurred_at)).toBeLessThanOrEqual(serverNow + 60_000)

    // Minutos (de los eventos) y un segundo móvil que lo descarga: mismo historial y mismo estado.
    const minutes = new Map(computeMinutes(local).map((m) => [m.playerId, m.minutesPlayed]))
    expect([minutes.get(players[9]!), minutes.get(players[11]!), minutes.get(players[0]!)]).toEqual([70, 20, 90])
    const jordi = await coachInTeam(team, 'Jordi')
    const b = await phone(jordi, team)
    expect((await b.sync()).ok).toBe(true)
    expect(shape(await listMatchEvents(b.db, matchId))).toEqual(shape(local))
    expect(await b.state(matchId)).toEqual(await a.state(matchId))
    // El modo pruebas es local: el otro móvil no lo tiene.
    expect((await b.match(matchId)).testMode).toBeFalsy()
  })
})
