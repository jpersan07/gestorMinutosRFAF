import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { listMatchEvents } from '../../src/data'
import { toRemoteEvent, type RemoteEventInput } from '../../src/data/remote/eventMapping'
import {
  anonClient,
  appendRaw,
  createTeam,
  createUser,
  expectError,
  matchScenario,
  must,
  p,
  serviceClient,
  takeControlRaw,
  type AppendResult,
} from './helpers'
import { MIN, phone, preparedLocally } from './phones'

// D-E9 (3e.1): la hora del SERVIDOR es la autoridad. Un evento con la hora claramente en el
// futuro (más de 60 s por delante del servidor al recibirlo) no se guarda: EVENT_IN_FUTURE.

type Scenario = Awaited<ReturnType<typeof matchScenario>>

const TOLERANCE_MS = 60_000

/** Partido empezado hace `minutesAgo` minutos (hora real) y ya subido al servidor. */
async function startedMinutesAgo(minutesAgo: number): Promise<Scenario> {
  const s = await matchScenario()
  s.device.now = Date.now() - minutesAgo * MIN
  s.device.kickOff(s.lineup)
  const result = await s.sync()
  expect(result.rejected).toBeNull()
  return s
}

async function serverSeqs(s: Scenario) {
  return must(await s.coach.client.from('match_events').select('seq').eq('match_id', s.matchId).order('seq')).data!.map((e) => e.seq)
}

const result = (data: unknown) => data as AppendResult

beforeAll(async () => {
  // La tolerancia de producción (los E2E la amplían en local mientras se ejecutan).
  expect(must(await serviceClient().rpc('set_event_time_policy', { p_max_future_ms: TOLERANCE_MS })).data).toBe(TOLERANCE_MS)
})

describe('horas de los eventos respecto a la hora del servidor', () => {
  it('hora válida (ya pasada): se acepta', async () => {
    const s = await startedMinutesAgo(20)
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '10:00')
    expect((await s.sync()).rejected).toBeNull()
    expect(await serverSeqs(s)).toHaveLength(s.device.events.length)
  })

  it('ligeramente adelantada (+30 s, dentro de la tolerancia): se acepta', async () => {
    const s = await startedMinutesAgo(20)
    s.device.now = Date.now() + 30_000
    s.device.sub(p(s.squad, 10), p(s.squad, 12))
    expect((await s.sync()).rejected).toBeNull()
    expect(await serverSeqs(s)).toHaveLength(s.device.events.length)
  })

  it('demasiado adelantada (+10 min): EVENT_IN_FUTURE; lo anterior del lote sí entra y nada más', async () => {
    const s = await startedMinutesAgo(20)
    s.device.at('15:00') // hace 5 minutos: válido
    s.device.sub(p(s.squad, 10), p(s.squad, 12))
    const valid = s.device.events.length
    s.device.now = Date.now() + 10 * MIN // reloj del móvil 10 min adelantado
    s.device.sub(p(s.squad, 9), p(s.squad, 13))
    const synced = await s.sync()
    expect(synced.rejected).toMatchObject({ seq: valid + 1, reason: 'EVENT_IN_FUTURE' })
    expect(synced.accepted).toHaveLength(2)
    expect(await serverSeqs(s)).toEqual(Array.from({ length: valid }, (_, i) => i + 1))

    // Ni siquiera con la clave de servicio se puede guardar un evento futuro.
    const future = s.device.events[valid]!
    expectError(
      await serviceClient()
        .from('match_events')
        .insert({
          id: randomUUID(),
          team_id: s.team.teamId,
          match_id: s.matchId,
          seq: valid + 1,
          event_type: 'MATCH_SAVED',
          occurred_at: new Date(future.occurredAt).toISOString(),
          device_id: 'clave-de-servicio',
          user_id: s.coach.id,
        }),
      'EVENT_IN_FUTURE',
    )
  })

  it('después del final real del partido: se rechaza (HALF_OVER / partido terminado)', async () => {
    // Partido completo que empezó hace 2 h: la 2ª parte terminó hace más de 20 min.
    const s = await startedMinutesAgo(120)
    s.device.toHalftime()
    s.device.secondHalf()
    await s.sync()
    const from = s.device.events.length
    s.device.sub(p(s.squad, 10), p(s.squad, 12), '80:00')
    const secondHalfStart = s.device.state.halfStartedAt[2]!
    const afterEnd = secondHalfStart + 50 * MIN // 95' teóricos, ya pasado respecto al servidor
    const late = s.device.events.slice(from).map(toRemoteEvent).map((e) => ({ ...e, occurred_at: afterEnd, match_second: 5400 }))
    expect(result((await appendRaw(s.coach, s.matchId, late)).data).rejected?.reason).toBe('HALF_OVER')

    // Con el final ya registrado, cualquier cambio posterior es una transición inválida.
    const s2 = await startedMinutesAgo(120)
    s2.device.toHalftime()
    s2.device.secondHalf()
    s2.device.sub(p(s2.squad, 10), p(s2.squad, 12), '80:00')
    s2.device.toFullTime()
    expect((await s2.sync()).rejected).toBeNull()
    const [out] = s2.device.events.filter((e) => e.type === 'PLAYER_OUT').map(toRemoteEvent)
    const next = s2.device.events.length + 1
    const substitution = randomUUID()
    const afterFullTime = [
      { ...out!, id: randomUUID(), seq: next, substitution_id: substitution, occurred_at: afterEnd },
    ]
    expect(result((await appendRaw(s2.coach, s2.matchId, afterFullTime)).data).rejected?.reason).toBe('INVALID_TRANSITION')
  })

  it('reenvío idempotente de un evento válido: duplicado (también si la tolerancia cambia después)', async () => {
    const s = await startedMinutesAgo(20)
    const all = s.device.events.map(toRemoteEvent)
    expect(result((await appendRaw(s.coach, s.matchId, all)).data)).toMatchObject({
      accepted: [],
      duplicates: all.map((e) => e.id),
      rejected: null,
    })
    try {
      must(await serviceClient().rpc('set_event_time_policy', { p_max_future_ms: 0 }))
      expect(result((await appendRaw(s.coach, s.matchId, all)).data)).toMatchObject({ rejected: null, accepted: [] })
    } finally {
      must(await serviceClient().rpc('set_event_time_policy', { p_max_future_ms: TOLERANCE_MS }))
    }
  })

  it('TOMAR CONTROL con hora futura: EVENT_IN_FUTURE y el control no cambia', async () => {
    const s = await startedMinutesAgo(20)
    const jordi = await createUser('Jordi')
    must(await serviceClient().from('team_members').insert({ team_id: s.team.teamId, user_id: jordi.id, role: 'coach' }))
    const takeover: RemoteEventInput = {
      ...toRemoteEvent(s.device.events.at(-1)!),
      id: randomUUID(),
      seq: s.device.events.length + 1,
      type: 'CONTROL_TAKEN',
      occurred_at: Date.now() + 10 * MIN,
      device_id: 'movil-de-jordi',
      half: null,
      match_second: null,
      payload: {},
    }
    expect(result((await takeControlRaw(jordi, s.matchId, 1, takeover)).data).rejected?.reason).toBe('EVENT_IN_FUTURE')
    const match = must(await s.coach.client.from('matches').select('control_epoch, controller_device_id').eq('id', s.matchId).single()).data!
    expect(match).toEqual({ control_epoch: 1, controller_device_id: s.device.deviceId })
  })

  it('solo la clave de servicio puede cambiar la tolerancia', async () => {
    const user = await createUser('Isaac')
    await createTeam([{ user, role: 'admin' }])
    expect((await user.client.rpc('set_event_time_policy', { p_max_future_ms: 86_400_000 })).error).not.toBeNull()
    expect((await anonClient().rpc('set_event_time_policy', { p_max_future_ms: 86_400_000 })).error).not.toBeNull()
    const noPrivate = await user.client.schema('private' as 'public').from('event_time_policy' as 'teams').select('*')
    expect(noPrivate.error).not.toBeNull()
  })
})

describe('móvil con el reloj 10 min adelantado', () => {
  it('con la corrección de la app (hora del servidor) todo se acepta; sin ella, queda pendiente y no se pierde', async () => {
    const isaac = await createUser('Isaac')
    const team = await createTeam([{ user: isaac, role: 'admin' }])

    // Como la app: mide la diferencia con el servidor y fecha los eventos con su hora.
    const corrected = await phone(isaac, team, { skewMs: 10 * MIN })
    await corrected.sync()
    const { matchId } = await preparedLocally(corrected)
    expect((await corrected.sync()).ok).toBe(true)
    const events = await listMatchEvents(corrected.db, matchId)
    expect(events.every((e) => e.syncState === 'synced')).toBe(true)
    for (const event of events) expect(Math.abs(event.occurredAt - Date.now())).toBeLessThan(TOLERANCE_MS)

    // Sin corrección: el servidor rechaza (hora futura) y el móvil reintentará; nada va a cuarentena.
    const jordi = await createUser('Jordi')
    must(await serviceClient().from('team_members').insert({ team_id: team.teamId, user_id: jordi.id, role: 'coach' }))
    const wrong = await phone(jordi, team, { skewMs: 10 * MIN, corrected: false })
    const other = await preparedLocally(wrong)
    const report = await wrong.push()
    expect(report.ok).toBe(false)
    expect(report.quarantined).toBe(0)
    expect(await wrong.db.rejectedEvents.count()).toBe(0)
    const pending = await listMatchEvents(wrong.db, other.matchId)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((e) => e.syncState === 'pending')).toBe(true)
    const server = must(await isaac.client.from('matches').select('last_seq').eq('id', other.matchId).single()).data!
    expect(server.last_seq).toBe(0)
  })
})

