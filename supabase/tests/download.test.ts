import { describe, expect, it } from 'vitest'
import {
  acknowledgeControlLoss,
  advanceMatch,
  canAcknowledgeControlLoss,
  listMatchEvents,
  supabaseRemote,
} from '../../src/data'
import { createTeam, createUser, must } from './helpers'
import { coachInTeam, crestDataUrl, kickedOff, MIN, phone, serverEvents, shape, sub } from './phones'

// Dos (o tres) "móviles" con la app real (IndexedDB simulado + código de sincronización) contra
// el Supabase LOCAL: descarga, fusión, TOMAR CONTROL y reloj del servidor (bloque 3d).

describe('móvil nuevo: descarga el equipo', () => {
  it('jugadores, temporadas, partido, escudo, convocatoria y eventos (en orden de seq)', async () => {
    const isaac = await createUser('Isaac')
    const team = await createTeam([{ user: isaac, role: 'admin' }])
    const a = await phone(isaac, team)
    const { players, matchId } = await kickedOff(a, { crest: crestDataUrl })

    const jordi = await coachInTeam(team, 'Jordi')
    const b = await phone(jordi, team)
    expect((await b.sync()).ok).toBe(true)

    expect((await b.db.players.toArray()).map((p) => p.id).sort()).toEqual([...players].sort())
    expect((await b.db.seasons.toArray()).map((s) => s.id)).toEqual([team.seasonId])
    const match = await b.match(matchId)
    expect(match).toMatchObject({
      opponent: 'CD Málaga',
      matchDate: '2026-10-10',
      kickoffTime: '18:00',
      status: 'first_half',
      controllerDeviceId: a.scope.deviceId,
      managedBy: isaac.id,
    })
    expect((await b.db.crests.get(match.crestId!))?.dataUrl).toBe(crestDataUrl)
    expect((await b.db.matchSquads.get(matchId))?.playerIds).toEqual(players)
    expect(shape(await listMatchEvents(b.db, matchId))).toEqual(shape(await listMatchEvents(a.db, matchId)))
    expect(await b.state(matchId)).toEqual(await a.state(matchId))
  })

  it('RLS: la descarga nunca devuelve datos de otro equipo', async () => {
    const isaac = await createUser('Isaac')
    const team = await createTeam([{ user: isaac, role: 'admin' }])
    const a = await phone(isaac, team)
    const { matchId } = await kickedOff(a)
    const outsider = await createUser('Otro')
    await createTeam([{ user: outsider, role: 'admin' }], 'Otro equipo')
    const remote = supabaseRemote(outsider.client)
    for (const table of ['players', 'matches', 'match_squads', 'match_reports', 'player_match_minutes'] as const) {
      expect(await remote.changedSince(table, team.teamId, null)).toEqual([])
    }
    expect(await remote.match(matchId)).toBeNull()
    expect(await remote.matchEventsAfter(matchId, 0)).toEqual([])
  })
})

describe('A sin conexión → B toma el control → A reconecta (escenario completo)', () => {
  it('cuarentena, CONTROL PERDIDO, estado oficial de B, ENTENDIDO después y recuperación del control', async () => {
    // 1. A inicia el partido y tiene el control.
    const isaac = await createUser('Isaac')
    const team = await createTeam([{ user: isaac, role: 'admin' }])
    const a = await phone(isaac, team)
    const { players, matchId } = await kickedOff(a)
    const jordi = await coachInTeam(team, 'Jordi')
    const b = await phone(jordi, team)

    // 2-3. A pierde la conexión (no sincroniza) y registra dos sustituciones.
    a.wait(10 * MIN)
    await a.run(matchId, sub(players, 10, 12))
    a.wait(2 * MIN)
    await a.run(matchId, sub(players, 11, 13))
    const offline = (await listMatchEvents(a.db, matchId)).filter((e) => e.syncState === 'pending')
    expect(offline).toHaveLength(4)

    // 4-6. B, con conexión, descarga el partido, toma el control y registra cambios.
    expect((await b.sync()).ok).toBe(true)
    b.wait(5 * MIN)
    expect(await b.take(matchId)).toEqual({ ok: true })
    b.wait(1 * MIN)
    await b.run(matchId, sub(players, 9, 14))
    expect((await b.sync()).ok).toBe(true)
    expect((await serverEvents(isaac, matchId)).at(-3)).toMatchObject({ event_type: 'CONTROL_TAKEN', device_id: b.scope.deviceId })

    // 7-11. A recupera la conexión e intenta subir: el servidor rechaza; cuarentena y CONTROL PERDIDO.
    const pushed = await a.push()
    expect(pushed).toMatchObject({ controlLost: [matchId], quarantined: 4 })
    const quarantine = await a.db.rejectedEvents.where('matchId').equals(matchId).sortBy('seq')
    expect(quarantine.map((q) => q.id)).toEqual(offline.map((e) => e.id))
    expect(quarantine.every((q) => q.reason === 'SEQ_CONFLICT')).toBe(true)
    // 16 (antes). ENTENDIDO todavía NO: falta el estado oficial.
    expect(canAcknowledgeControlLoss(await a.match(matchId), await listMatchEvents(a.db, matchId), a.scope)).toBe(false)
    expect(await acknowledgeControlLoss(a.db, a.env, matchId, a.scope)).toEqual({ ok: false, error: { code: 'OFFICIAL_STATE_PENDING' } })

    // 12-14. A descarga los eventos oficiales de B y reconstruye: exactamente el estado de B.
    expect((await a.sync()).ok).toBe(true)
    expect(shape(await listMatchEvents(a.db, matchId))).toEqual(shape(await listMatchEvents(b.db, matchId)))
    expect(await a.state(matchId)).toEqual(await b.state(matchId))
    expect((await serverEvents(isaac, matchId)).map((e) => e.id)).toEqual((await listMatchEvents(a.db, matchId)).map((e) => e.id))
    expect((await serverEvents(isaac, matchId)).some((e) => offline.some((o) => o.id === e.id))).toBe(false)

    // 15. A no puede seguir registrando (ni cambios ni finales automáticos).
    expect(await a.command(matchId, sub(players, 2, 12))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
    expect(await advanceMatch(a.db, a.env, matchId, a.actor)).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })

    // 16. Con el estado oficial ya cargado, ENTENDIDO sí; no devuelve el control.
    expect(await acknowledgeControlLoss(a.db, a.env, matchId, a.scope)).toEqual({ ok: true, value: undefined })
    expect(await a.command(matchId, sub(players, 2, 12))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
    expect(await a.db.rejectedEvents.where('matchId').equals(matchId).count()).toBe(4) // la cuarentena no se borra

    // 17-18. A intenta TOMAR CONTROL; el servidor se lo concede y vuelve a poder trabajar.
    a.wait(2 * MIN)
    expect(await a.take(matchId)).toEqual({ ok: true })
    expect(await a.match(matchId)).toMatchObject({ controlLostAt: null, controllerDeviceId: a.scope.deviceId })
    a.wait(MIN)
    await a.run(matchId, sub(players, 2, 12))
    expect((await a.sync()).ok).toBe(true)
    expect((await a.state(matchId)).substitutions).toHaveLength(2) // el de B y el nuevo de A (lo de la cuarentena, no)

    // B se entera en su siguiente descarga y queda en consulta con el estado oficial.
    const report = await b.sync()
    expect(report.controlLost).toEqual([matchId])
    expect(await b.match(matchId)).toMatchObject({ controlLossReason: 'TAKEN_BY_OTHER' })
    expect(await b.state(matchId)).toEqual(await a.state(matchId))
    expect(await b.command(matchId, sub(players, 3, 11))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
  })

  it('A y B pulsan TOMAR CONTROL a la vez: solo uno gana; el otro queda en consulta con el estado oficial', async () => {
    const isaac = await createUser('Isaac')
    const team = await createTeam([{ user: isaac, role: 'admin' }])
    const owner = await phone(isaac, team)
    const { matchId } = await kickedOff(owner)
    const [jordi, jose] = [await coachInTeam(team, 'Jordi'), await coachInTeam(team, 'Jose')]
    const a = await phone(jordi, team)
    const b = await phone(jose, team)
    await a.sync()
    await b.sync()

    // Los dos han descargado el mismo control_epoch antes de que ninguno pida el control.
    let arrived = 0
    let release: () => void = () => undefined
    const bothReady = new Promise<void>((resolve) => (release = resolve))
    for (const device of [a, b]) {
      const original = device.remote.takeControl
      device.remote.takeControl = async (...args) => {
        if (++arrived === 2) release()
        await bothReady
        return original(...args)
      }
    }
    const [ra, rb] = await Promise.all([a.take(matchId), b.take(matchId)])
    expect([ra, rb].filter((r) => r.ok)).toHaveLength(1)
    expect([ra, rb].filter((r) => !r.ok && r.reason === 'TAKEN_BY_OTHER')).toHaveLength(1)
    const [winner, loser] = ra.ok ? [a, b] : [b, a]
    const server = must(await isaac.client.from('matches').select('controller_device_id, control_epoch').eq('id', matchId).single()).data!
    expect(server).toEqual({ controller_device_id: winner.scope.deviceId, control_epoch: 2 })
    expect((await loser.match(matchId)).controllerDeviceId).toBe(winner.scope.deviceId)
    expect(shape(await listMatchEvents(loser.db, matchId))).toEqual(shape(await listMatchEvents(winner.db, matchId)))
    expect(await loser.command(matchId, { type: 'UNDO_LAST_SUBSTITUTION' })).toMatchObject({ ok: false, error: { code: 'NOT_CONTROLLER' } })
  })
})

describe('relojes distintos: la hora del servidor es la referencia', () => {
  it('A (+3 min) y B (−3 min) generan tiempos coherentes; sin corrección el servidor rechaza a B', async () => {
    const isaac = await createUser('Isaac')
    const team = await createTeam([{ user: isaac, role: 'admin' }])
    const a = await phone(isaac, team, { skewMs: 3 * MIN })
    await a.sync() // mide la diferencia con el servidor
    const before = Date.now()
    const { players, matchId } = await kickedOff(a)
    const kickOff = (await listMatchEvents(a.db, matchId)).find((e) => e.type === 'HALF_STARTED')!
    // Aunque el reloj de A va 3 min adelantado, el partido empieza a la hora del servidor.
    expect(Math.abs(kickOff.occurredAt - before)).toBeLessThan(5_000)

    // B lleva el reloj 3 min atrasado y NO corrige: su cambio quedaría antes del inicio del partido.
    const jordi = await coachInTeam(team, 'Jordi')
    const wrong = await phone(jordi, team, { skewMs: -3 * MIN, corrected: false })
    await wrong.sync()
    expect(await wrong.take(matchId)).toEqual({ ok: true })
    await wrong.run(matchId, sub(players, 10, 12))
    const rejected = await wrong.push()
    expect(rejected.quarantined).toBe(2) // el servidor, autoridad final, no acepta tiempos incoherentes
    expect((await wrong.db.rejectedEvents.toArray())[0]?.reason).toMatch(/INVALID|HALF|SECOND/)

    // B con corrección (como la app): toma el control y su cambio tiene el tiempo correcto.
    const jose = await coachInTeam(team, 'Jose')
    const b = await phone(jose, team, { skewMs: -3 * MIN })
    await b.sync()
    expect(await b.take(matchId)).toEqual({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await b.run(matchId, sub(players, 11, 13))
    expect((await b.sync()).ok).toBe(true)
    const out = (await listMatchEvents(b.db, matchId)).find((e) => e.type === 'PLAYER_OUT')!
    expect(out.type === 'PLAYER_OUT' && out.matchSecond).toBe(Math.floor((out.occurredAt - kickOff.occurredAt) / 1000))
    expect(Math.abs(out.occurredAt - Date.now())).toBeLessThan(5_000)
    // A ve exactamente el mismo minuto.
    await a.sync()
    expect((await a.state(matchId)).substitutions).toEqual((await b.state(matchId)).substitutions)
  })
})
