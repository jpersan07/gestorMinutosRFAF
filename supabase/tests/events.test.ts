import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { benchPlayers, FORMATION_IDS, FORMATIONS, getFormation } from '../../src/domain'
import { lineupOf, seededRandom } from '../../src/domain/__tests__/harness'
import type { Json } from '../../src/data/remote/database.types'
import { toRemoteEvent, type RemoteEventInput } from '../../src/data/remote/eventMapping'
import {
  append,
  appendRaw,
  createTeam,
  anonClient,
  createUser,
  expectError,
  matchScenario,
  must,
  p,
  serviceClient,
  takeControlRaw,
  type AppendResult,
} from './helpers'

type Scenario = Awaited<ReturnType<typeof matchScenario>>

/** Envía los eventos pendientes del móvil cambiando uno (para simular un móvil manipulado o con errores). */
async function syncTampered(
  s: Scenario,
  tamper: (event: RemoteEventInput, index: number) => RemoteEventInput,
  from: number,
): Promise<AppendResult> {
  const pending = s.device.events.slice(from).map(toRemoteEvent).map(tamper)
  const { data, error } = await appendRaw(s.coach, s.matchId, pending)
  if (error) throw new Error(error.message)
  return data as unknown as AppendResult
}


async function serverMatch(s: Scenario) {
  return must(await s.coach.client.from('matches').select('*').eq('id', s.matchId).single()).data!
}

describe('eventos válidos generados por el motor de la app', () => {
  it('partido completo: el servidor acepta todo y deriva el estado de los eventos', async () => {
    const s = await matchScenario()
    const statuses: string[] = []
    const step = async () => statuses.push((await s.sync()).match.status)

    s.device.must({ type: 'START_SETUP' })
    await step()
    s.device.must({ type: 'CONFIRM_LINEUP', lineup: s.lineup })
    s.device.must({ type: 'START_MATCH' })
    await step()
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '20:13')
    s.device.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    s.device.sub(p(s.squad, 10), p(s.squad, 13), '30:07')
    s.device.toHalftime()
    await step()
    s.device.secondHalf()
    await step()
    s.device.sub(p(s.squad, 13), p(s.squad, 10), '70:00') // reentrada
    s.device.toFullTime()
    await step()
    expect(statuses).toEqual(['setup', 'first_half', 'halftime', 'second_half', 'finished'])

    // Guardar exige RESULTADO en el servidor.
    s.device.must({ type: 'SAVE_MATCH' })
    const withoutReport = await s.sync()
    expect(withoutReport.rejected?.reason).toBe('RESULT_REQUIRED')
    must(
      await s.coach.client
        .from('match_reports')
        .insert({ match_id: s.matchId, team_id: s.team.teamId, result: '2-1', observations: '' }),
    )
    expect((await s.sync()).match.status).toBe('saved')

    const match = await serverMatch(s)
    expect(match).toMatchObject({
      status: 'saved',
      last_seq: s.device.events.length,
      controller_device_id: s.device.deviceId,
      controller_user_id: s.coach.id,
      managed_by: s.coach.id,
    })
    const events = must(await s.coach.client.from('match_events').select('id, seq, user_id').eq('match_id', s.matchId).order('seq'))
    expect(events.data?.map((e) => e.id)).toEqual(s.device.events.map((e) => e.id))
    // El autor es el usuario autenticado, no lo que diga el móvil.
    expect(events.data?.every((e) => e.user_id === s.coach.id)).toBe(true)
  })

  it('reenviar los mismos eventos es idempotente', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    const first = await append(s.coach, s.matchId, s.device.events)
    const again = await append(s.coach, s.matchId, s.device.events)
    expect(first.accepted).toHaveLength(s.device.events.length)
    expect(again).toMatchObject({ accepted: [], rejected: null })
    expect(again.duplicates).toHaveLength(s.device.events.length)
  })

  it('al pulsar PLAY la convocatoria del servidor queda congelada como la del evento', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const squad = must(await s.coach.client.from('match_squads').select('player_ids').eq('match_id', s.matchId).single())
    expect(squad.data?.player_ids).toEqual(s.squad)
  })

  it.each(Array.from({ length: 15 }, (_, i) => i + 1))('partido aleatorio #%i (reentradas, deshacer, cambios de formación)', async (seed) => {
    const s = await matchScenario()
    const random = seededRandom(seed)
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
    const playHalf = (from: number, to: number) => {
      const times = Array.from({ length: Math.floor(random() * 7) }, () => from + 1 + Math.floor(random() * (to - from - 1))).sort(
        (a, b) => a - b,
      )
      for (const second of times) {
        s.device.sub(pick(Object.values(s.device.state.onField)), pick(benchPlayers(s.device.state)), second)
        if (random() < 0.25) s.device.must({ type: 'UNDO_LAST_SUBSTITUTION' })
      }
    }

    s.device.kickOff(s.lineup)
    playHalf(0, 2700)
    await s.sync()
    s.device.toHalftime()
    const formationId = pick(FORMATION_IDS)
    const shuffled = [...s.squad].sort(() => random() - 0.5)
    s.device.wait(Math.floor(random() * 600))
    s.device.secondHalf(lineupOf(formationId, shuffled.slice(0, getFormation(formationId).slots.length)))
    playHalf(2700, 5400)
    s.device.toFullTime()
    const result = await s.sync()

    expect(result.rejected).toBeNull()
    expect(result.match).toMatchObject({ status: 'finished', last_seq: s.device.events.length })
  })
})

describe('el servidor no se fía del móvil: rechaza eventos inválidos', () => {
  it('huecos en la secuencia', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    const events = s.device.events.map(toRemoteEvent)
    const { data } = await appendRaw(s.coach, s.matchId, [events[0]!, events[2]!])
    expect((data as unknown as AppendResult).rejected?.reason).toBe('SEQ_GAP')
  })

  it('minutos inventados: el segundo de partido debe cuadrar con los timestamps', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '30:00')
    const result = await syncTampered(s, (e) => ({ ...e, match_second: 600 }), from)
    expect(result.rejected?.reason).toBe('INVALID_MATCH_SECOND')
  })

  it('final de parte que no es a la hora exacta', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.toHalftime()
    const result = await syncTampered(s, (e) => ({ ...e, occurred_at: e.occurred_at - 60_000 }), from)
    expect(result.rejected?.reason).toBe('INVALID_HALF_END')
  })

  it('segunda parte antes de los 15 segundos de descanso', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    s.device.toHalftime()
    await s.sync()
    const from = s.device.events.length
    s.device.secondHalf()
    const halfEnd = s.device.state.halfEndedAt[1]!
    const result = await syncTampered(
      s,
      (e) => (e.type === 'HALF_STARTED' ? { ...e, occurred_at: halfEnd + 10_000 } : e),
      from,
    )
    expect(result.rejected?.reason).toBe('HALFTIME_WAIT')
  })

  it('cambio de un jugador que no está en el campo', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const result = await syncTampered(s, (e) => ({ ...e, player_id: p(s.squad, 13) }), from)
    expect(result.rejected?.reason).toBe('PLAYER_NOT_ON_FIELD')
  })

  it('entra un jugador que ya está en el campo', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const result = await syncTampered(s, (e) => (e.type === 'PLAYER_OUT' ? { ...e, related_player_id: p(s.squad, 9) } : e), from)
    expect(result.rejected?.reason).toBe('PLAYER_ALREADY_ON_FIELD')
  })

  it('entra un jugador no convocado', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const notCalledUp = p(s.playerIds, 16)
    const result = await syncTampered(s, (e) => (e.type === 'PLAYER_OUT' ? { ...e, related_player_id: notCalledUp } : e), from)
    expect(result.rejected?.reason).toBe('PLAYER_NOT_IN_SQUAD')
  })

  it('PLAYER_IN que no corresponde a su PLAYER_OUT', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const result = await syncTampered(s, (e) => (e.type === 'PLAYER_IN' ? { ...e, player_id: p(s.squad, 13) } : e), from)
    expect(result.rejected?.reason).toBe('SUBSTITUTION_MISMATCH')
  })

  it('cambio después del final de la parte', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '44:00')
    const result = await syncTampered(s, (e) => ({ ...e, occurred_at: e.occurred_at + 120_000, match_second: 2700 }), from)
    expect(result.rejected?.reason).toBe('HALF_OVER')
  })

  it('deshacer un cambio que no es el último', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    const [firstOut] = s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    s.device.sub(p(s.squad, 9), p(s.squad, 13), '20:00')
    await s.sync()
    const from = s.device.events.length
    s.device.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    const firstSubId = firstOut!.type === 'PLAYER_OUT' ? firstOut!.substitutionId : ''
    const result = await syncTampered(s, (e) => ({ ...e, substitution_id: firstSubId }), from)
    expect(result.rejected?.reason).toBe('NOT_LAST_SUBSTITUTION')
  })

  it('alineaciones inválidas: incompleta, posición inexistente, jugador repetido o no convocado', async () => {
    const cases: Array<[string, (lineup: { formationId: string; slots: Record<string, string> }) => unknown]> = [
      ['LINEUP_INCOMPLETE', (l) => ({ ...l, slots: Object.fromEntries(Object.entries(l.slots).slice(0, 10)) })],
      ['UNKNOWN_SLOT', (l) => ({ ...l, slots: { ...l.slots, LWB: Object.values(l.slots)[0] } })],
      ['PLAYER_DUPLICATED', (l) => ({ ...l, slots: { ...l.slots, RW: l.slots.GK } })],
      ['UNKNOWN_FORMATION', (l) => ({ ...l, formationId: '4-4-2' })],
    ]
    for (const [reason, mutate] of cases) {
      const s = await matchScenario()
      s.device.setup(s.lineup)
      const result = await syncTampered(
        s,
        (e) =>
          e.type === 'LINEUP_CONFIRMED'
            ? { ...e, payload: { lineup: mutate(e.payload.lineup as { formationId: string; slots: Record<string, string> }) } }
            : e,
        0,
      )
      expect(result.rejected?.reason, reason).toBe(reason)
    }

    const s = await matchScenario()
    s.device.setup(s.lineup)
    const notCalledUp = p(s.playerIds, 16)
    const result = await syncTampered(
      s,
      (e) =>
        e.type === 'LINEUP_CONFIRMED'
          ? { ...e, payload: { lineup: { ...s.lineup, slots: { ...s.lineup.slots, RW: notCalledUp } } } }
          : e,
      0,
    )
    expect(result.rejected?.reason).toBe('PLAYER_NOT_IN_SQUAD')
  })

  it('transiciones imposibles: cambios antes de empezar, eventos tras guardar', async () => {
    const s = await matchScenario()
    s.device.setup(s.lineup)
    await s.sync()
    const bogusSub: RemoteEventInput = {
      ...toRemoteEvent(s.device.events.at(-1)!),
      id: randomUUID(),
      seq: s.device.events.length + 1,
      type: 'PLAYER_OUT',
      half: 1,
      match_second: 0,
      player_id: p(s.squad, 1),
      related_player_id: p(s.squad, 12),
      substitution_id: randomUUID(),
      slot_id: 'GK',
      payload: {},
    }
    const { data } = await appendRaw(s.coach, s.matchId, [bogusSub])
    expect((data as unknown as AppendResult).rejected?.reason).toBe('INVALID_TRANSITION')

    s.device.must({ type: 'START_MATCH' })
    s.device.toHalftime()
    s.device.secondHalf()
    s.device.toFullTime()
    await s.sync()
    must(await s.coach.client.from('match_reports').insert({ match_id: s.matchId, team_id: s.team.teamId, result: '0-0' }))
    s.device.must({ type: 'SAVE_MATCH' })
    await s.sync()
    const afterSave: RemoteEventInput = { ...bogusSub, id: randomUUID(), seq: s.device.events.length + 1, type: 'CONTROL_TAKEN' }
    const { data: locked } = await takeControlRaw(s.coach, s.matchId, 1, afterSave)
    expect((locked as unknown as AppendResult).rejected?.reason).toBe('MATCH_LOCKED')
  })

  it('PLAY con jugadores de otro equipo en la convocatoria', async () => {
    const s = await matchScenario()
    s.device.setup(s.lineup)
    s.device.must({ type: 'START_MATCH' })
    const result = await syncTampered(
      s,
      (e) => (e.type === 'MATCH_STARTED' ? { ...e, payload: { ...e.payload, squad: [...s.squad, randomUUID()] } } : e),
      0,
    )
    expect(result.rejected?.reason).toBe('SQUAD_PLAYER_NOT_IN_TEAM')
  })
})

describe('control único del partido (TOMAR CONTROL)', () => {
  async function withSecondCoach() {
    const s = await matchScenario()
    const jordi = await createUser('Jordi')
    must(await serviceClient().from('team_members').insert({ team_id: s.team.teamId, user_id: jordi.id, role: 'coach' }))
    return { s, jordi }
  }

  it('otro dispositivo no puede escribir sin tomar el control', async () => {
    const { s, jordi } = await withSecondCoach()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const pending = s.device.events.slice(from).map(toRemoteEvent).map((e) => ({ ...e, device_id: 'movil-de-jordi' }))
    const { data } = await appendRaw(jordi, s.matchId, pending)
    expect((data as unknown as AppendResult).rejected?.reason).toBe('NOT_CONTROLLER')
  })

  it('el mismo usuario desde otro dispositivo tampoco', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const result = await syncTampered(s, (e) => ({ ...e, device_id: 'otro-movil' }), from)
    expect(result.rejected?.reason).toBe('NOT_CONTROLLER')
  })

  it('TOMAR CONTROL: el nuevo controlador escribe; el anterior queda rechazado', async () => {
    const { s, jordi } = await withSecondCoach()
    s.device.kickOff(s.lineup)
    await s.sync()

    // El móvil de Jordi (con los eventos sincronizados) toma el control.
    const takeover: RemoteEventInput = {
      ...toRemoteEvent(s.device.events.at(-1)!),
      id: randomUUID(),
      seq: s.device.events.length + 1,
      type: 'CONTROL_TAKEN',
      device_id: 'movil-de-jordi',
      occurred_at: s.device.now + 1_000,
      half: null,
      match_second: null,
      payload: {},
    }
    const taken = await takeControlRaw(jordi, s.matchId, 1, takeover)
    expect((taken.data as unknown as AppendResult).match).toMatchObject({
      controller_device_id: 'movil-de-jordi',
      control_epoch: 2,
    })

    // El móvil de Isaac, que no se enteró (sin conexión), intenta seguir: su seq choca.
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const stale = await s.sync()
    expect(stale.rejected?.reason).toBe('SEQ_CONFLICT')

    const match = await serverMatch(s)
    expect(match).toMatchObject({ controller_device_id: 'movil-de-jordi', controller_user_id: jordi.id, managed_by: jordi.id })
  })

  it('dos TOMAR CONTROL a la vez con el mismo control_epoch: solo uno gana (el otro, CONTROL_CHANGED)', async () => {
    const { s, jordi } = await withSecondCoach()
    s.device.kickOff(s.lineup)
    await s.sync()
    const base = toRemoteEvent(s.device.events.at(-1)!)
    const seq = s.device.events.length + 1
    const takeover = (device: string): RemoteEventInput => ({
      ...base,
      id: randomUUID(),
      seq,
      type: 'CONTROL_TAKEN',
      device_id: device,
      half: null,
      match_second: null,
      payload: {},
    })
    const [a, b] = await Promise.all([
      takeControlRaw(jordi, s.matchId, 1, takeover('movil-jordi-1')),
      takeControlRaw(jordi, s.matchId, 1, takeover('movil-jordi-2')),
    ])
    const results = [a.data, b.data] as unknown as AppendResult[]
    expect(results.filter((r) => r.accepted.length === 1)).toHaveLength(1)
    expect(results.filter((r) => r.rejected?.reason === 'CONTROL_CHANGED')).toHaveLength(1)
    expect(await serverMatch(s)).toMatchObject({ control_epoch: 2, last_seq: seq })
  })

  it('dos lotes distintos con el mismo seq a la vez: el bloqueo del partido deja pasar solo uno', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const first = s.device.events.slice(from).map(toRemoteEvent)
    const otherSubstitution = randomUUID()
    const second = first.map((e) => ({ ...e, id: randomUUID(), substitution_id: otherSubstitution }))
    const [a, b] = await Promise.all([appendRaw(s.coach, s.matchId, first), appendRaw(s.coach, s.matchId, second)])
    const results = [a.data, b.data] as unknown as AppendResult[]
    expect(results.filter((r) => r.accepted.length === 2)).toHaveLength(1)
    expect(results.filter((r) => r.rejected?.reason === 'SEQ_CONFLICT')).toHaveLength(1)
  })

  it('tomar el control cuando ya lo tienes se rechaza', async () => {
    const s = await matchScenario()
    s.device.setup(s.lineup)
    await s.sync()
    const again: RemoteEventInput = {
      ...toRemoteEvent(s.device.events.at(-1)!),
      id: randomUUID(),
      seq: s.device.events.length + 1,
      type: 'CONTROL_TAKEN',
      half: null,
      payload: {},
    }
    const { data } = await takeControlRaw(s.coach, s.matchId, 1, again)
    expect((data as unknown as AppendResult).rejected?.reason).toBe('ALREADY_CONTROLLER')
  })
})

describe('TOMAR CONTROL solo por take_match_control (3d)', () => {
  const takeover = (s: Scenario, device: string): RemoteEventInput => ({
    ...toRemoteEvent(s.device.events.at(-1)!),
    id: randomUUID(),
    seq: s.device.events.length + 1,
    type: 'CONTROL_TAKEN',
    device_id: device,
    half: null,
    match_second: null,
    player_id: null,
    related_player_id: null,
    substitution_id: null,
    slot_id: null,
    payload: {},
  })

  it('append_match_events no acepta CONTROL_TAKEN: procesa lo anterior y lo rechaza (TAKE_CONTROL_REQUIRED)', async () => {
    const s = await matchScenario()
    s.device.setup(s.lineup)
    const before = s.device.events.slice()
    const control = { ...takeover(s, 'otro-movil'), seq: before.length + 1 }
    const { data } = await appendRaw(s.coach, s.matchId, [...before.map(toRemoteEvent), control])
    const result = data as unknown as AppendResult
    expect(result.accepted).toHaveLength(before.length)
    expect(result.rejected).toMatchObject({ id: control.id, reason: 'TAKE_CONTROL_REQUIRED' })
    expect(await serverMatch(s)).toMatchObject({ control_epoch: 1, last_seq: before.length })
  })

  it('con un control_epoch que ya no es el actual no se escribe nada (CONTROL_CHANGED)', async () => {
    const s = await matchScenario()
    const jordi = await createUser('Jordi')
    must(await serviceClient().from('team_members').insert({ team_id: s.team.teamId, user_id: jordi.id, role: 'coach' }))
    s.device.kickOff(s.lineup)
    await s.sync()
    const { data } = await takeControlRaw(jordi, s.matchId, 0, takeover(s, 'movil-de-jordi'))
    expect((data as unknown as AppendResult).rejected?.reason).toBe('CONTROL_CHANGED')
    expect(await serverMatch(s)).toMatchObject({ control_epoch: 1, controller_device_id: s.device.deviceId })
    // Reintento idempotente de una toma ya aceptada: duplicado, aunque el epoch ya haya cambiado.
    const event = takeover(s, 'movil-de-jordi')
    expect((await takeControlRaw(jordi, s.matchId, 1, event)).data).toMatchObject({ rejected: null })
    expect((await takeControlRaw(jordi, s.matchId, 1, event)).data).toMatchObject({ duplicates: [event.id], rejected: null })
  })

  it('solo miembros del equipo; la validación interna no se puede llamar directamente', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const outsider = await createUser('Otro')
    await createTeam([{ user: outsider, role: 'admin' }], 'Otro equipo')
    expectError(await takeControlRaw(outsider, s.matchId, 1, takeover(s, 'intruso')), 'MATCH_NOT_FOUND')
    const anonymous = await anonClient().rpc('take_match_control', {
      p_match_id: s.matchId,
      p_expected_control_epoch: 1,
      p_event: takeover(s, 'anon') as unknown as Json,
    })
    expect(anonymous.error).not.toBeNull()
    const bypass = await s.coach.client.schema('private' as 'public').rpc('append_match_events_unchecked' as 'append_match_events', {
      p_match_id: s.matchId,
      p_events: [takeover(s, 'bypass')] as unknown as Json,
    })
    expect(bypass.error).not.toBeNull()
    expect(await serverMatch(s)).toMatchObject({ control_epoch: 1 })
  })

  it('hora del servidor: solo con sesión', async () => {
    const user = await createUser('Isaac')
    const before = Date.now()
    const { data } = must(await user.client.rpc('server_time'))
    expect(Number(data)).toBeGreaterThan(before - 60_000)
    expect(Number(data)).toBeLessThan(Date.now() + 60_000)
    expect((await anonClient().rpc('server_time')).error).not.toBeNull()
  })
})

describe('historial sin huecos (garantía de la base de datos)', () => {
  it('un evento con seq = n no puede existir sin el n − 1, ni siquiera con la clave de servicio', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const last = s.device.events.length
    const row = (seq: number) => ({
      id: randomUUID(),
      team_id: s.team.teamId,
      match_id: s.matchId,
      seq,
      event_type: 'MATCH_SAVED' as const,
      occurred_at: new Date().toISOString(),
      device_id: 'clave-de-servicio',
      user_id: s.coach.id,
    })
    expectError(await serviceClient().from('match_events').insert(row(last + 2)), 'SEQ_GAP')
    expectError(await serviceClient().from('match_events').insert(row(last + 5)), 'SEQ_GAP')
    // Por la puerta normal, un salto de seq tampoco se acepta.
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    const skipped = s.device.events.slice(last + 1).map(toRemoteEvent)
    expect(((await appendRaw(s.coach, s.matchId, skipped)).data as unknown as AppendResult).rejected?.reason).toBe('SEQ_GAP')
    // El historial del servidor es 1..last_seq, sin huecos.
    const seqs = must(await s.coach.client.from('match_events').select('seq').eq('match_id', s.matchId).order('seq')).data!
    expect(seqs.map((e) => e.seq)).toEqual(Array.from({ length: last }, (_, i) => i + 1))
    expect((await serverMatch(s)).last_seq).toBe(last)
  })
})

describe('historial inmutable', () => {
  it('nadie puede modificar ni borrar eventos, ni siquiera con la clave de servicio', async () => {
    const s = await matchScenario()
    s.device.kickOff(s.lineup)
    await s.sync()
    const admin = serviceClient()
    expectError(await admin.from('match_events').update({ seq: 99 }).eq('match_id', s.matchId), 'MATCH_EVENTS_ARE_IMMUTABLE')
    expectError(await admin.from('match_events').delete().eq('match_id', s.matchId), 'MATCH_EVENTS_ARE_IMMUTABLE')
    expectError(await s.coach.client.from('match_events').delete().eq('match_id', s.matchId), '42501')
  })

  it('un evento con id ya usado en otro partido se rechaza', async () => {
    const s = await matchScenario()
    s.device.setup(s.lineup)
    await s.sync()
    const otherMatch = randomUUID()
    must(
      await s.coach.client
        .from('matches')
        .insert({ id: otherMatch, team_id: s.team.teamId, season_id: s.team.seasonId, opponent: 'Otro' }),
    )
    const reused = { ...toRemoteEvent(s.device.events[0]!) }
    const { data } = await appendRaw(s.coach, otherMatch, [reused])
    expect((data as unknown as AppendResult).rejected?.reason).toBe('ID_CONFLICT')
  })
})

describe('referencias compartidas con el dominio', () => {
  it('las formaciones del servidor coinciden con las de la app', async () => {
    const user = await createUser('Isaac')
    await createTeam([{ user, role: 'admin' }])
    const rows = must(await user.client.from('formation_slots').select('formation_id, slot_id, role')).data ?? []
    const server = rows.map((r) => `${r.formation_id}:${r.slot_id}:${r.role}`).sort()
    const app = FORMATION_IDS.flatMap((id) => FORMATIONS[id].slots.map((slot) => `${id}:${slot.id}:${slot.role}`)).sort()
    expect(server).toEqual(app)
  })
})
