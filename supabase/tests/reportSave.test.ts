import { describe, expect, it } from 'vitest'
import { advanceMatch, countPending, listMatchEvents, loadMatchState, pushOnce, saveMatch, saveReport, type Supabase } from '../../src/data'
import { lineupOnField, type Id } from '../../src/domain'
import { createTeam, createUser, must, serviceClient, type Client } from './helpers'
import { coachInTeam, kickedOff, MIN, phone, type Phone } from './phones'

// Guardar el partido nunca pierde el informe (bug de 30/09/2026), contra el servidor REAL:
// MATCH_SAVED bloquea el informe y los minutos (MATCH_LOCKED), así que tienen que estar aceptados
// antes de enviarlo, también si la red se corta a mitad.

const OBSERVATIONS = 'Buen partido.\nLesión leve de Jugador 5.'

async function finishedMatch() {
  const coach = await createUser('Isaac')
  const team = await createTeam([{ user: coach, role: 'admin' }])
  const a = await phone(coach, team)
  const { matchId } = await kickedOff(a)
  a.wait(45 * MIN)
  await advanceMatch(a.db, a.env, matchId, a.actor)
  await a.run(matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(await a.state(matchId))! })
  a.wait(15_000)
  await a.run(matchId, { type: 'START_SECOND_HALF' })
  a.wait(46 * MIN)
  expect((await advanceMatch(a.db, a.env, matchId, a.actor)).ok).toBe(true)
  expect((await a.sync()).ok).toBe(true)
  return { coach, team, a, matchId }
}

/** Resultado ya subido (guardado automático) y, enseguida, observaciones y GUARDAR PARTIDO. */
async function quickSave(a: Phone, matchId: Id) {
  expect((await saveReport(a.db, a.env, matchId, { result: '3-1', observations: '' }, a.scope.userId)).ok).toBe(true)
  expect((await a.sync()).ok).toBe(true)
  a.wait(1_000)
  expect((await saveReport(a.db, a.env, matchId, { result: '3-1', observations: OBSERVATIONS }, a.scope.userId)).ok).toBe(true)
  expect((await saveMatch(a.db, a.env, matchId, a.actor)).ok).toBe(true)
}

async function serverState(matchId: Id) {
  const admin = serviceClient()
  const match = must(await admin.from('matches').select('status').eq('id', matchId).single()).data!
  const report = must(await admin.from('match_reports').select('result, observations, updated_at').eq('match_id', matchId).single()).data!
  const events = must(await admin.from('match_events').select('id, event_type').eq('match_id', matchId).order('seq')).data!
  return { status: match.status, report, events }
}

async function expectSavedWithReport(a: Phone, matchId: Id) {
  const server = await serverState(matchId)
  expect(server.status).toBe('saved')
  expect(server.report).toMatchObject({ result: '3-1', observations: OBSERVATIONS })
  expect(server.events.map((e) => e.id)).toEqual((await listMatchEvents(a.db, matchId)).map((e) => e.id))
  expect(await a.db.matchReports.get(matchId)).toMatchObject({ result: '3-1', observations: OBSERVATIONS, syncState: 'synced' })
  expect(await countPending(a.db)).toBe(0)
}

/** Cliente que ejecuta `atSave` justo antes de enviar MATCH_SAVED; 'offline' = la red se corta. */
function beforeMatchSaved(client: Client, atSave: () => Promise<'offline' | void>): Supabase {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'rpc') return Reflect.get(target, property, receiver)
      return async (name: string, args: { p_events?: Array<{ type: string }> }) => {
        if (args.p_events?.some((e) => e.type === 'MATCH_SAVED') && (await atSave()) === 'offline') {
          return { data: null, error: { message: 'TypeError: Failed to fetch' } }
        }
        return target.rpc(name as never, args as never)
      }
    },
  }) as unknown as Supabase
}

describe('guardar el partido nunca pierde el informe (servidor real)', () => {
  it('A · guardado rápido: el servidor queda SAVED con resultado + observaciones', async () => {
    const { a, matchId } = await finishedMatch()
    await quickSave(a, matchId)
    expect((await a.sync()).ok).toBe(true)
    await expectSavedWithReport(a, matchId)
  })

  it('B · cuando llega MATCH_SAVED el servidor YA ha aceptado el informe (y el partido aún no está guardado)', async () => {
    const { coach, a, matchId } = await finishedMatch()
    await quickSave(a, matchId)
    const seen: Array<{ status: string; observations: string }> = []
    const client = beforeMatchSaved(coach.client, async () => {
      const server = await serverState(matchId)
      seen.push({ status: server.status, observations: server.report.observations })
    })
    expect((await pushOnce({ db: a.db, supabase: client, scope: a.scope })).ok).toBe(true)
    expect(seen).toEqual([{ status: 'finished', observations: OBSERVATIONS }])
    await expectSavedWithReport(a, matchId)
  })

  it('C · red perdida entre el informe y MATCH_SAVED → reconexión y reintento: todo correcto y sin duplicados', async () => {
    const { coach, a, matchId } = await finishedMatch()
    await quickSave(a, matchId)
    const offline = beforeMatchSaved(coach.client, async () => 'offline')
    expect((await pushOnce({ db: a.db, supabase: offline, scope: a.scope })).ok).toBe(false)
    const cut = await serverState(matchId)
    expect(cut.status).toBe('finished')
    expect(cut.report.observations).toBe(OBSERVATIONS)
    expect(cut.events.some((e) => e.event_type === 'MATCH_SAVED')).toBe(false)

    expect((await a.sync()).ok).toBe(true)
    expect((await a.sync()).ok).toBe(true) // reenviar no cambia nada
    await expectSavedWithReport(a, matchId)
  })

  it('F · otro móvil descarga el estado oficial: SAVED y el mismo informe', async () => {
    const { team, a, matchId } = await finishedMatch()
    await quickSave(a, matchId)
    expect((await a.sync()).ok).toBe(true)

    const b = await phone(await coachInTeam(team, 'Jordi'), team)
    expect((await b.sync()).ok).toBe(true)
    expect((await loadMatchState(b.db, matchId)).status).toBe('saved')
    const reportA = (await a.db.matchReports.get(matchId))!
    expect(await b.db.matchReports.get(matchId)).toMatchObject({
      result: '3-1',
      observations: OBSERVATIONS,
      updatedAt: reportA.updatedAt,
    })
    expect((await a.sync()).ok).toBe(true)
    expect(await a.db.matchReports.get(matchId)).toEqual(reportA)
  })
})
