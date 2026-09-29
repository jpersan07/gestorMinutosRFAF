import { describe, expect, it } from 'vitest'
import { lineupOnField } from '../../domain'
import {
  advanceMatch,
  classifyEventRejection,
  classifyRowError,
  countPending,
  crestUpload,
  findActiveMatchId,
  listMatchEvents,
  loadMatchState,
  logError,
  matchRow,
  MAX_LOCAL_ERRORS,
  playerRow,
  pushOnce,
  quarantineRejectedEvents,
  runMatchCommand,
  saveSquad,
  selectEventsToQuarantine,
  type Actor,
  type StoredEvent,
  type Supabase,
} from '..'
import { fixture, lineupOf, openTestDb, reopen, type Fixture } from './testDb'

const actorOf = (f: Fixture): Actor => ({ deviceId: f.scope.deviceId, coachId: f.coachId })

async function kickedOff() {
  const f = await fixture()
  await saveSquad(f.db, f.env, f.matchId, f.playerIds, f.coachId)
  for (const command of [
    { type: 'START_SETUP' as const },
    { type: 'CONFIRM_LINEUP' as const, lineup: lineupOf('4-3-3', f.playerIds.slice(0, 11)) },
    { type: 'START_MATCH' as const },
  ]) {
    const result = await runMatchCommand(f.db, f.env, f.matchId, command, actorOf(f))
    if (!result.ok) throw new Error(JSON.stringify(result.error))
  }
  return f
}

/** Simula que el servidor ya aceptó todos los eventos actuales. */
async function markAllEventsSynced(f: Fixture) {
  const events = await listMatchEvents(f.db, f.matchId)
  for (const e of events) await f.db.matchEvents.update(e.id, { syncState: 'synced' })
}

describe('clasificación de respuestas del servidor', () => {
  it('eventos: nunca "gana el último"; control perdido, informe pendiente, reintento o inválido', () => {
    expect(classifyEventRejection('SEQ_CONFLICT')).toBe('control-lost')
    expect(classifyEventRejection('NOT_CONTROLLER')).toBe('control-lost')
    expect(classifyEventRejection('RESULT_REQUIRED')).toBe('needs-report')
    expect(classifyEventRejection('SEQ_GAP')).toBe('retry')
    expect(classifyEventRejection('INVALID_MATCH_SECOND')).toBe('invalid')
    expect(classifyEventRejection('PLAYER_NOT_ON_FIELD')).toBe('invalid')
  })

  it('filas editables: dorsal ocupado y partido bloqueado son conflictos; lo demás se reintenta', () => {
    expect(
      classifyRowError({ code: '23505', message: 'duplicate key value violates unique constraint "players_active_number_uq"' }),
    ).toEqual({ kind: 'conflict', issue: 'NUMBER_TAKEN' })
    expect(classifyRowError({ code: 'P0001', message: 'MATCH_DETAILS_LOCKED' })).toEqual({ kind: 'conflict', issue: 'MATCH_LOCKED' })
    expect(classifyRowError({ code: 'P0001', message: 'SQUAD_LOCKED' })).toEqual({ kind: 'conflict', issue: 'MATCH_LOCKED' })
    expect(classifyRowError({ code: 'P0001', message: 'MATCH_NOT_FINISHED' })).toEqual({ kind: 'retry' })
    expect(classifyRowError({ message: 'TypeError: Failed to fetch' })).toEqual({ kind: 'retry' })
  })
})

describe('conversión a filas del servidor', () => {
  it('el partido sube sus datos con la hora de la última EDICIÓN, nunca estado ni controlador', async () => {
    const f = await kickedOff()
    f.env.wait(60)
    await runMatchCommand(f.db, f.env, f.matchId, { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! }, actorOf(f))
    const match = (await f.db.matches.get(f.matchId))!
    expect(match.updatedAt).toBeGreaterThan(match.detailsUpdatedAt!) // los eventos cambian updatedAt
    const row = matchRow(match)
    expect(row.updated_at).toBe(new Date(match.detailsUpdatedAt!).toISOString())
    expect(row).not.toHaveProperty('status')
    expect(row).not.toHaveProperty('controller_device_id')
    expect(row).not.toHaveProperty('saved_at')
  })

  it('jugador y escudo', async () => {
    const f = await fixture()
    const player = (await f.db.players.get(f.playerIds[0]!))!
    expect(playerRow(player)).toMatchObject({ id: player.id, team_id: 'team-1', number: 1, active: true })
    const upload = crestUpload(
      { id: 'crest-1', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', createdAt: 0, updatedAt: 0, syncState: 'pending' },
      'team-1',
    )
    expect(upload).toMatchObject({ path: 'team-1/crest-1.png', contentType: 'image/png', row: { storage_path: 'team-1/crest-1.png', size_bytes: 8 } })
    expect(crestUpload({ id: 'x', dataUrl: 'no-es-una-imagen', createdAt: 0, updatedAt: 0, syncState: 'pending' }, 't')).toBeNull()
  })
})

describe('cuarentena de eventos rechazados', () => {
  it('selecciona el rechazado y los PENDIENTES posteriores del mismo partido', () => {
    const e = (id: string, seq: number, syncState: StoredEvent['syncState'], matchId = 'm1') =>
      ({ id, seq, syncState, matchId }) as StoredEvent
    const events = [e('a', 1, 'synced'), e('b', 2, 'pending'), e('c', 3, 'pending'), e('d', 4, 'pending'), e('x', 5, 'pending', 'm2')]
    expect(selectEventsToQuarantine(events, 'c').map((x) => x.id)).toEqual(['c', 'd'])
    expect(selectEventsToQuarantine(events, 'no-existe')).toEqual([])
  })

  it('control perdido: aparta los eventos, recalcula el partido y bloquea TODA escritura en él', async () => {
    const f = await kickedOff()
    await markAllEventsSynced(f)
    const before = await loadMatchState(f.db, f.matchId)

    // Sin conexión, el móvil registra un cambio (queda pendiente).
    f.env.wait(10 * 60)
    const sub = await runMatchCommand(
      f.db,
      f.env,
      f.matchId,
      { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! },
      actorOf(f),
    )
    expect(sub.ok).toBe(true)
    const pending = (await listMatchEvents(f.db, f.matchId)).filter((e) => e.syncState === 'pending')
    expect(pending.map((e) => e.type)).toEqual(['PLAYER_OUT', 'PLAYER_IN'])

    // El servidor rechaza el primero: otro dispositivo tomó el control.
    const moved = await quarantineRejectedEvents(f.db, f.matchId, { id: pending[0]!.id, reason: 'SEQ_CONFLICT' }, {
      controlLost: true,
      now: f.env.now(),
    })
    expect(moved).toBe(2)

    // Fuera del historial válido; en cuarentena, íntegros.
    expect((await listMatchEvents(f.db, f.matchId)).map((e) => e.id)).not.toContain(pending[0]!.id)
    const quarantined = await f.db.rejectedEvents.where('matchId').equals(f.matchId).sortBy('seq')
    expect(quarantined.map((q) => [q.event.type, q.reason, q.rejectedEventId])).toEqual([
      ['PLAYER_OUT', 'SEQ_CONFLICT', pending[0]!.id],
      ['PLAYER_IN', 'SEQ_CONFLICT', pending[0]!.id],
    ])

    // El estado válido es el de antes del cambio rechazado; los minutos no lo cuentan.
    const after = await loadMatchState(f.db, f.matchId)
    expect(after.onField).toEqual(before.onField)
    expect(after.substitutions).toEqual([])
    const match = (await f.db.matches.get(f.matchId))!
    expect(match).toMatchObject({ controlLossReason: 'SEQ_CONFLICT' })
    expect(match.controlLostAt).toBe(f.env.now())

    // A no puede seguir: ni comandos, ni final automático, ni guardar.
    const blocked = await runMatchCommand(
      f.db,
      f.env,
      f.matchId,
      { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! },
      actorOf(f),
    )
    expect(blocked).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
    f.env.wait(60 * 60)
    expect(await advanceMatch(f.db, f.env, f.matchId, actorOf(f))).toEqual({ ok: false, error: { code: 'CONTROL_LOST' } })
    expect((await listMatchEvents(f.db, f.matchId)).some((e) => e.type === 'HALF_ENDED')).toBe(false)

    // Ya no se reabre al arrancar como "partido en juego de este móvil".
    expect(await findActiveMatchId(f.db, f.scope.deviceId)).toBeNull()

    // Persistente: sobrevive a cerrar y abrir la app.
    const db = reopen(f.db)
    expect((await db.matches.get(f.matchId))?.controlLostAt).toBe(f.env.now() - 60 * 60 * 1000)
    expect(await db.rejectedEvents.count()).toBe(2)
  })

  it('rechazo por contenido inválido: cuarentena SIN bloquear el partido; minutos recalculados', async () => {
    const f = await kickedOff()
    f.env.wait(20 * 60)
    await runMatchCommand(f.db, f.env, f.matchId, { type: 'SUBSTITUTE', outPlayerId: f.playerIds[9]!, inPlayerId: f.playerIds[11]! }, actorOf(f))
    f.env.wait(30 * 60)
    await advanceMatch(f.db, f.env, f.matchId, actorOf(f))
    const state = await loadMatchState(f.db, f.matchId)
    await runMatchCommand(f.db, f.env, f.matchId, { type: 'CONFIRM_LINEUP', lineup: lineupOnField(state)! }, actorOf(f))
    f.env.wait(15)
    await runMatchCommand(f.db, f.env, f.matchId, { type: 'START_SECOND_HALF' }, actorOf(f))
    f.env.wait(46 * 60)
    await advanceMatch(f.db, f.env, f.matchId, actorOf(f))
    expect((await f.db.matches.get(f.matchId))?.status).toBe('finished')
    await markAllEventsSynced(f)
    const events = await listMatchEvents(f.db, f.matchId)
    const sub = events.find((e) => e.type === 'PLAYER_OUT')!
    // Supongamos que el cambio no se había subido y el servidor lo rechaza por contenido.
    for (const e of events.filter((x) => x.seq >= sub.seq)) await f.db.matchEvents.update(e.id, { syncState: 'pending' })

    await quarantineRejectedEvents(f.db, f.matchId, { id: sub.id, reason: 'INVALID_MATCH_SECOND' }, { controlLost: false, now: f.env.now() })
    const match = (await f.db.matches.get(f.matchId))!
    expect(match.controlLostAt ?? null).toBeNull()
    expect(match.status).toBe('first_half')
    expect(await f.db.playerMatchMinutes.where('matchId').equals(f.matchId).count()).toBe(0)
    expect(await f.db.rejectedEvents.where('matchId').equals(f.matchId).count()).toBeGreaterThan(0)
    // No es pérdida de control: este móvil sigue pudiendo escribir en el partido.
    expect((await advanceMatch(f.db, f.env, f.matchId, actorOf(f))).ok).toBe(true)
  })
})

describe('modelo local y registro de errores', () => {
  it('actualización v2 → v3 sin pérdida: tablas nuevas y datos existentes intactos', async () => {
    const { default: Dexie } = await import('dexie')
    const { AppDatabase } = await import('../db')
    const name = `upgrade-v3-${Math.random()}`
    const v2 = new Dexie(name)
    v2.version(1).stores({
      meta: 'key', teams: 'id', seasons: 'id, teamId', coaches: 'id, teamId', players: 'id, teamId',
      matches: 'id, teamId, seasonId, status', matchSquads: 'matchId', matchEvents: 'id, matchId, &[matchId+seq]',
      lineupDrafts: '[matchId+half]', matchReports: 'matchId', playerMatchMinutes: '[matchId+playerId], matchId, playerId',
      crests: 'id', errorLog: '++id, createdAt',
    })
    v2.version(2).stores({ coaches: null, profiles: 'id', teamMembers: '[teamId+userId], teamId, userId' })
    await v2.table('players').put({ id: 'p1', teamId: 't', name: 'A', number: 7, active: true, syncState: 'pending' })
    v2.close()

    const v3 = new AppDatabase(name)
    expect(await v3.players.where('syncState').equals('pending').count()).toBe(1)
    expect(await v3.rejectedEvents.count()).toBe(0)
    v3.close()
    await v3.delete()
  })

  it('sin conexión se guardan como mucho los últimos 200 errores técnicos', async () => {
    const db = openTestDb()
    for (let i = 0; i < MAX_LOCAL_ERRORS + 15; i++) await logError(db, new Error(`error ${i}`))
    expect(await db.errorLog.count()).toBe(MAX_LOCAL_ERRORS)
    expect((await db.errorLog.orderBy('id').first())?.message).toBe('Error: error 15')
  })

  it('cuenta lo pendiente de subir', async () => {
    const f = await kickedOff()
    expect(await countPending(f.db)).toBeGreaterThan(16) // jugadores, partido, convocatoria y eventos
    await markAllEventsSynced(f)
    const pendingEvents = await f.db.matchEvents.where('syncState').equals('pending').count()
    expect(pendingEvents).toBe(0)
  })
})

describe('exclusión mutua de la subida', () => {
  it('dos subidas lanzadas a la vez nunca se solapan', async () => {
    const f = await fixture()
    let active = 0
    let maxActive = 0
    const slow = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return { error: null, data: { accepted: [], duplicates: [], rejected: null } }
    }
    const table = { upsert: slow, insert: slow }
    const supabase = {
      from: () => table,
      rpc: slow,
      storage: { from: () => ({ upload: slow }) },
    } as unknown as Supabase
    await Promise.all([
      pushOnce({ db: f.db, supabase, scope: f.scope }),
      pushOnce({ db: f.db, supabase, scope: f.scope }),
    ])
    expect(maxActive).toBe(1)
    expect(await f.db.players.where('syncState').equals('pending').count()).toBe(0)
  })
})
