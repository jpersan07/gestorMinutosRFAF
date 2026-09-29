import { describe, expect, it } from 'vitest'
import {
  createMatch,
  createPlayer,
  listMatches,
  listPlayers,
  sortMatches,
  updateMatchDetails,
  updatePlayer,
  type MatchRecord,
} from '..'
import { fixture } from './testDb'

describe('jugadores', () => {
  it('AÑADIR JUGADOR con nombre y dorsal lo deja activo en el equipo', async () => {
    const { db, env, scope } = await fixture()
    const result = await createPlayer(db, env, scope.teamId, { name: '  Jorge ', number: 99 })
    expect(result).toMatchObject({ ok: true, value: { name: 'Jorge', number: 99, active: true, teamId: scope.teamId } })
  })

  it('nombre y dorsal son obligatorios', async () => {
    const { db, env, scope } = await fixture()
    expect(await createPlayer(db, env, scope.teamId, { name: ' ', number: null })).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION',
        errors: [
          { field: 'name', code: 'REQUIRED' },
          { field: 'number', code: 'REQUIRED' },
        ],
      },
    })
  })

  it('no permite dorsales repetidos entre jugadores activos ni fuera de 0–99', async () => {
    const { db, env, scope } = await fixture()
    expect(await createPlayer(db, env, scope.teamId, { name: 'X', number: 7 })).toMatchObject({
      ok: false,
      error: { errors: [{ field: 'number', code: 'TAKEN' }] },
    })
    expect(await createPlayer(db, env, scope.teamId, { name: 'X', number: 100 })).toMatchObject({
      ok: false,
      error: { errors: [{ field: 'number', code: 'INVALID' }] },
    })
  })

  it('editar: cambia datos; dar de baja libera el dorsal; reactivar comprueba el dorsal', async () => {
    const { db, env, scope, playerIds } = await fixture()
    const seven = playerIds[6]!
    expect(await updatePlayer(db, env, seven, { name: 'Siete', number: 7, active: false })).toMatchObject({
      ok: true,
      value: { name: 'Siete', active: false },
    })
    const newSeven = await createPlayer(db, env, scope.teamId, { name: 'Nuevo 7', number: 7 })
    expect(newSeven.ok).toBe(true)
    expect(await updatePlayer(db, env, seven, { name: 'Siete', number: 7, active: true })).toMatchObject({
      ok: false,
      error: { errors: [{ field: 'number', code: 'TAKEN' }] },
    })
  })

  it('se listan por dorsal', async () => {
    const { db, env, scope } = await fixture()
    await createPlayer(db, env, scope.teamId, { name: 'Cero', number: 0 })
    const numbers = (await listPlayers(db, scope.teamId)).map((p) => p.number)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(numbers[0]).toBe(0)
  })
})

describe('partidos', () => {
  it('NUEVO PARTIDO solo exige el rival; el resto puede quedar vacío', async () => {
    const { db, env, scope } = await fixture()
    const result = await createMatch(db, env, scope, { opponent: ' Equipo X ', matchDate: '', kickoffTime: ' ', location: null })
    expect(result).toMatchObject({
      ok: true,
      value: {
        opponent: 'Equipo X',
        matchDate: null,
        kickoffTime: null,
        location: null,
        crestId: null,
        status: 'scheduled',
        seasonId: scope.seasonId,
      },
    })
    expect(await createMatch(db, env, scope, { opponent: '', matchDate: null, kickoffTime: null, location: null })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', errors: [{ field: 'opponent', code: 'REQUIRED' }] },
    })
  })

  it('valida el formato de fecha y hora', async () => {
    const { db, env, scope } = await fixture()
    const result = await createMatch(db, env, scope, {
      opponent: 'X',
      matchDate: '2026-02-30',
      kickoffTime: '25:00',
      location: null,
    })
    expect(result).toMatchObject({
      ok: false,
      error: {
        errors: [
          { field: 'matchDate', code: 'INVALID' },
          { field: 'kickoffTime', code: 'INVALID' },
        ],
      },
    })
  })

  it('EDITAR completa los datos y gestiona el escudo (poner, cambiar, quitar)', async () => {
    const { db, env, matchId } = await fixture()
    const base = { opponent: 'Rival', matchDate: '2026-10-03', kickoffTime: '17:30', location: 'Campo Municipal' }

    const withCrest = await updateMatchDetails(db, env, matchId, { ...base, crest: 'data:image/webp;base64,AAA' })
    expect(withCrest.ok && withCrest.value.crestId).toBeTruthy()
    expect(await db.crests.count()).toBe(1)

    const replaced = await updateMatchDetails(db, env, matchId, { ...base, crest: 'data:image/webp;base64,BBB' })
    const crestId = replaced.ok ? replaced.value.crestId : null
    expect((await db.crests.get(crestId!))?.dataUrl).toBe('data:image/webp;base64,BBB')
    expect(await db.crests.count()).toBe(1)

    const kept = await updateMatchDetails(db, env, matchId, { ...base, location: 'Otro campo' })
    expect(kept).toMatchObject({ ok: true, value: { crestId, location: 'Otro campo' } })

    const removed = await updateMatchDetails(db, env, matchId, { ...base, crest: null })
    expect(removed).toMatchObject({ ok: true, value: { crestId: null } })
    expect(await db.crests.count()).toBe(0)
  })

  it('se ordenan por fecha y hora; los que no tienen fecha van al final', () => {
    const m = (id: string, matchDate: string | null, kickoffTime: string | null, createdAt: number) =>
      ({ id, matchDate, kickoffTime, createdAt }) as MatchRecord
    const sorted = sortMatches([
      m('sin-fecha-2', null, null, 2),
      m('oct', '2026-10-05', null, 0),
      m('sep-tarde', '2026-09-28', '19:00', 0),
      m('sin-fecha-1', null, null, 1),
      m('sep-mañana', '2026-09-28', '10:00', 0),
    ])
    expect(sorted.map((x) => x.id)).toEqual(['sep-mañana', 'sep-tarde', 'oct', 'sin-fecha-1', 'sin-fecha-2'])
  })

  it('se listan por temporada', async () => {
    const { db, scope } = await fixture()
    expect(await listMatches(db, scope.seasonId)).toHaveLength(1)
    expect(await listMatches(db, 'otra-temporada')).toHaveLength(0)
  })

  it('todos los registros son JSON plano (exportables y ampliables)', async () => {
    const { db, env, matchId } = await fixture()
    await updateMatchDetails(db, env, matchId, {
      opponent: 'Rival',
      matchDate: null,
      kickoffTime: null,
      location: null,
      crest: 'data:image/png;base64,AAA',
    })
    for (const table of db.tables) {
      for (const record of await table.toArray()) {
        expect(JSON.parse(JSON.stringify(record))).toEqual(record)
      }
    }
  })
})
