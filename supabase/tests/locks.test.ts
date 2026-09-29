import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createPlayers, createTeam, createUser, expectError, matchScenario, must, p } from './helpers'

const iso = (ms: number) => new Date(ms).toISOString()

describe('"gana el último" (updated_at del móvil)', () => {
  it('un cambio más antiguo que el guardado se ignora; uno más nuevo se aplica', async () => {
    const user = await createUser('Isaac')
    const team = await createTeam([{ user, role: 'admin' }])
    const [playerId] = await createPlayers(user, team.teamId, 1)
    const base = Date.now()

    must(await user.client.from('players').update({ name: 'Nuevo', updated_at: iso(base + 60_000) }).eq('id', playerId!))
    must(await user.client.from('players').update({ name: 'Viejo', updated_at: iso(base + 1_000) }).eq('id', playerId!))
    let row = must(await user.client.from('players').select('name, synced_at').eq('id', playerId!).single())
    expect(row.data?.name).toBe('Nuevo')

    must(await user.client.from('players').update({ name: 'Más nuevo', updated_at: iso(base + 120_000) }).eq('id', playerId!))
    row = must(await user.client.from('players').select('name').eq('id', playerId!).single())
    expect(row.data?.name).toBe('Más nuevo')
  })

  it('synced_at lo pone el servidor aunque el móvil tenga la hora mal', async () => {
    const user = await createUser('Isaac')
    const team = await createTeam([{ user, role: 'admin' }])
    const before = Date.now()
    const id = randomUUID()
    must(
      await user.client
        .from('players')
        .insert({ id, team_id: team.teamId, name: 'X', number: 1, updated_at: iso(Date.UTC(2000, 0, 1)) }),
    )
    const row = must(await user.client.from('players').select('synced_at').eq('id', id).single())
    expect(Date.parse(row.data!.synced_at)).toBeGreaterThanOrEqual(before - 5_000)
  })
})

describe('reglas de jugadores', () => {
  it('dos jugadores activos no pueden compartir dorsal; una baja libera el dorsal', async () => {
    const user = await createUser('Isaac')
    const team = await createTeam([{ user, role: 'admin' }])
    const [seven] = await createPlayers(user, team.teamId, 1, 7)
    expectError(await user.client.from('players').insert({ id: randomUUID(), team_id: team.teamId, name: 'Otro', number: 7 }), '23505')
    must(await user.client.from('players').update({ active: false, updated_at: iso(Date.now() + 1000) }).eq('id', seven!))
    must(await user.client.from('players').insert({ id: randomUUID(), team_id: team.teamId, name: 'Otro', number: 7 }))
  })
})

describe('bloqueos de la Fase 2 en el servidor', () => {
  it('datos del partido: editables en preparación, bloqueados desde PLAY', async () => {
    const s = await matchScenario()
    s.device.setup(s.lineup)
    await s.sync()
    must(await s.coach.client.from('matches').update({ location: 'Campo 2', updated_at: iso(Date.now()) }).eq('id', s.matchId))

    s.device.must({ type: 'START_MATCH' })
    await s.sync()
    expectError(
      await s.coach.client.from('matches').update({ location: 'Campo 3', updated_at: iso(Date.now() + 1000) }).eq('id', s.matchId),
      'MATCH_DETAILS_LOCKED',
    )
  })

  it('convocatoria: jugadores del equipo, sin duplicados; bloqueada y congelada desde PLAY', async () => {
    const s = await matchScenario()
    const other = await createUser('Otro')
    const otherTeam = await createTeam([{ user: other, role: 'admin' }])
    const [foreign] = await createPlayers(other, otherTeam.teamId, 1)
    expectError(
      await s.coach.client.from('match_squads').update({ player_ids: [foreign!], updated_at: iso(Date.now()) }).eq('match_id', s.matchId),
      'SQUAD_PLAYER_NOT_IN_TEAM',
    )

    const withDuplicate = [...s.squad, p(s.squad, 1)]
    must(
      await s.coach.client.from('match_squads').update({ player_ids: withDuplicate, updated_at: iso(Date.now()) }).eq('match_id', s.matchId),
    )
    const deduped = must(await s.coach.client.from('match_squads').select('player_ids').eq('match_id', s.matchId).single())
    expect(deduped.data?.player_ids).toEqual(s.squad)

    s.device.kickOff(s.lineup)
    await s.sync()
    expectError(
      await s.coach.client
        .from('match_squads')
        .update({ player_ids: s.squad.slice(0, 12), updated_at: iso(Date.now() + 60_000) })
        .eq('match_id', s.matchId),
      'SQUAD_LOCKED',
    )
  })

  it('informe y minutos: solo con el partido finalizado; nada cambia una vez guardado', async () => {
    const s = await matchScenario()
    const report = (result: string, offset: number) =>
      s.coach.client
        .from('match_reports')
        .upsert({ match_id: s.matchId, team_id: s.team.teamId, result, observations: '', updated_at: iso(Date.now() + offset) })
    const minutes = (seconds: number) =>
      s.coach.client.from('player_match_minutes').upsert({
        match_id: s.matchId,
        player_id: p(s.squad, 1),
        team_id: s.team.teamId,
        seconds_played: seconds,
        minutes_played: Math.floor(seconds / 60),
        started: true,
        updated_at: iso(Date.now()),
      })

    s.device.kickOff(s.lineup)
    await s.sync()
    expectError(await report('1-0', 0), 'MATCH_NOT_FINISHED')
    expectError(await minutes(5400), 'MATCH_NOT_FINISHED')

    s.device.toHalftime()
    s.device.secondHalf()
    s.device.toFullTime()
    expect((await s.sync()).match.status).toBe('finished')
    must(await report('2-1', 1_000))
    must(await minutes(5400))

    s.device.must({ type: 'SAVE_MATCH' })
    expect((await s.sync()).match.status).toBe('saved')

    expectError(await report('3-1', 2_000), 'MATCH_LOCKED')
    must(await report('2-1', 3_000)) // reenviar exactamente lo mismo no falla
    expectError(await minutes(5300), 'MATCH_LOCKED')
    must(await minutes(5400))
  })
})

describe('escudos (referencia a Storage)', () => {
  it('la ruta debe ser <equipo>/<id>.<ext> y el registro es inmutable', async () => {
    const user = await createUser('Isaac')
    const team = await createTeam([{ user, role: 'admin' }])
    const id = randomUUID()
    expectError(
      await user.client.from('crests').insert({
        id,
        team_id: team.teamId,
        storage_path: `otra-carpeta/${id}.png`,
        mime_type: 'image/png',
        size_bytes: 100,
      }),
      '23514',
    )
    must(
      await user.client.from('crests').insert({
        id,
        team_id: team.teamId,
        storage_path: `${team.teamId}/${id}.png`,
        mime_type: 'image/png',
        size_bytes: 100,
      }),
    )
    expectError(await user.client.from('crests').update({ size_bytes: 200 }).eq('id', id), '42501')
    expectError(await user.client.from('crests').delete().eq('id', id), '42501')
  })
})
