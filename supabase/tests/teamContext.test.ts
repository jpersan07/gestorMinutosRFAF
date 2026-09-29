import { describe, expect, it } from 'vitest'
import { loadMemberships, loadTeamContext } from '../../src/data/remote/teamContext'
import { createTeam, createUser, must, serviceClient } from './helpers'

describe('contexto de equipo que descarga la app al iniciar sesión', () => {
  it('equipos de la cuenta, temporada activa y compañeros con su rol', async () => {
    const isaac = await createUser('ISAAC')
    const jordi = await createUser('JORDI')
    const team = await createTeam(
      [
        { user: isaac, role: 'admin' },
        { user: jordi, role: 'coach' },
      ],
      'Equipo Contexto',
    )

    expect(await loadMemberships(isaac.client, isaac.id)).toEqual([
      { teamId: team.teamId, teamName: 'Equipo Contexto', role: 'admin' },
    ])

    const context = await loadTeamContext(jordi.client, team.teamId)
    expect(context.team).toEqual({ id: team.teamId, name: 'Equipo Contexto', currentSeasonId: team.seasonId })
    expect(context.season).toEqual({ id: team.seasonId, name: '2026-27' })
    expect([...context.members].sort((a, b) => a.displayName.localeCompare(b.displayName))).toEqual([
      { userId: isaac.id, displayName: 'ISAAC', role: 'admin' },
      { userId: jordi.id, displayName: 'JORDI', role: 'coach' },
    ])
  })

  it('una cuenta en varios equipos los ve todos (para elegir)', async () => {
    const coach = await createUser('Multi')
    const a = await createTeam([{ user: coach, role: 'coach' }], 'Alevín A')
    const b = await createTeam([{ user: coach, role: 'admin' }], 'Benjamín B')
    expect(await loadMemberships(coach.client, coach.id)).toEqual([
      { teamId: a.teamId, teamName: 'Alevín A', role: 'coach' },
      { teamId: b.teamId, teamName: 'Benjamín B', role: 'admin' },
    ])
  })

  it('una cuenta sin equipo no tiene membresías', async () => {
    const loner = await createUser('Solo')
    expect(await loadMemberships(loner.client, loner.id)).toEqual([])
  })

  it('equipo sin temporada activa: season = null (la app lo explica)', async () => {
    const coach = await createUser('SinTemporada')
    const team = await createTeam([{ user: coach, role: 'admin' }], 'Sin temporada')
    must(await serviceClient().from('teams').update({ current_season_id: null }).eq('id', team.teamId))
    const context = await loadTeamContext(coach.client, team.teamId)
    expect(context.season).toBeNull()
  })

  it('no se puede cargar el contexto de un equipo ajeno', async () => {
    const coach = await createUser('Isaac')
    const outsider = await createUser('Otro')
    const team = await createTeam([{ user: coach, role: 'admin' }])
    await expect(loadTeamContext(outsider.client, team.teamId)).rejects.toMatchObject({ code: 'PGRST116' })
  })
})
