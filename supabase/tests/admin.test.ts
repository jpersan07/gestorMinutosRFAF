import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadMemberships } from '../../src/data'
import { MatchHarness, lineupOf } from '../../src/domain/__tests__/harness'
import { append, createPlayers, createUser, env, expectError, matchScenario, must, serviceClient } from './helpers'

// Plantillas SQL de administración (supabase/admin), ejecutadas como en el SQL Editor del panel
// (usuario postgres) contra el Supabase LOCAL, con los marcadores sustituidos por datos de prueba.

const ADMIN = 'supabase/admin'

/** Ejecuta un script con psql; devuelve la salida (NOTICE incluidos) o lanza con el error. */
function runSql(file: string, values: Record<string, string> = {}): string {
  let sql = readFileSync(`${ADMIN}/${file}`, 'utf8')
  for (const [placeholder, value] of Object.entries(values)) sql = sql.replaceAll(placeholder, value)
  try {
    return execFileSync('psql', [env.dbUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(String((error as { stderr?: string }).stderr ?? error))
  }
}

const teamByName = async (name: string) => must(await serviceClient().from('teams').select('id, current_season_id').eq('name', name).single()).data!

describe('plantillas de administración', () => {
  it('no contienen datos reales: solo marcadores < > (y ningún secreto)', () => {
    for (const file of readdirSync(ADMIN).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(`${ADMIN}/${file}`, 'utf8')
      expect(sql, file).not.toMatch(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/) // emails (los patrones '%@…' de las consultas no lo son)
      expect(sql, file).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) // UUID
      expect(sql, file).not.toMatch(/service_role|sb_secret_|eyJ[A-Za-z0-9_-]{10,}/)
    }
  })

  it('sin sustituir los marcadores, no cambian nada', () => {
    for (const file of ['01_crear_equipo_y_temporada.sql', '02_nueva_temporada_y_activar.sql', '04_anadir_entrenador_al_equipo.sql', '05_retirar_entrenador_del_equipo.sql']) {
      expect(() => runSql(file), file).toThrow(/Sustituye los valores entre < >/)
    }
  })

  it('equipo → temporada → entrenadores → nueva temporada → retirar; y las consultas', async () => {
    const teamName = `Equipo admin ${randomUUID().slice(0, 8)}`
    expect(runSql('01_crear_equipo_y_temporada.sql', { '<NOMBRE_DEL_EQUIPO>': teamName, '<TEMPORADA_AAAA-AA>': '2026-27' })).toContain(teamName)
    const team = await teamByName(teamName)
    expect(team.current_season_id).toBeTruthy()
    // No se duplica un equipo con el mismo nombre.
    expect(() => runSql('01_crear_equipo_y_temporada.sql', { '<NOMBRE_DEL_EQUIPO>': teamName, '<TEMPORADA_AAAA-AA>': '2026-27' })).toThrow(/Ya existe/)

    // Cuentas creadas como en el panel (Authentication → Add user); después, la plantilla 04.
    const admin = await createUser('Admin')
    const coach = await createUser('Coach')
    const add = (email: string, role: string, name: string) =>
      runSql('04_anadir_entrenador_al_equipo.sql', {
        '<EMAIL_DEL_ENTRENADOR>': email,
        '<ID_DEL_EQUIPO>': team.id,
        '<coach o admin>': role,
        '<NOMBRE_VISIBLE>': name,
      })
    add(admin.email, 'admin', 'Admin de prueba')
    add(coach.email, 'coach', 'Entrenador de prueba')
    expect(() => add('nadie@test.local', 'coach', 'Nadie')).toThrow(/No existe ninguna cuenta/)

    // El entrenador entra en la app y ve el equipo; su nombre visible es el de la plantilla.
    expect((await loadMemberships(coach.client, coach.id)).map((m) => [m.teamName, m.role])).toEqual([[teamName, 'coach']])
    expect(must(await coach.client.from('profiles').select('display_name').eq('id', coach.id).single()).data!.display_name).toBe('Entrenador de prueba')

    // Consultas (solo lectura).
    expect(runSql('03_consultar_usuarios.sql')).toContain(coach.email)
    expect(runSql('06_consultar_miembros.sql')).toContain('Entrenador de prueba')
    expect(runSql('07_consultar_equipos_y_temporadas.sql')).toContain(teamName)
    runSql('08_consultar_errores_tecnicos.sql')

    // Nueva temporada activa (la anterior se conserva).
    runSql('02_nueva_temporada_y_activar.sql', { '<ID_DEL_EQUIPO>': team.id, '<TEMPORADA_AAAA-AA>': '2027-28' })
    const seasons = must(await serviceClient().from('seasons').select('id, name').eq('team_id', team.id).order('name')).data!
    expect(seasons.map((s) => s.name)).toEqual(['2026-27', '2027-28'])
    expect((await teamByName(teamName)).current_season_id).toBe(seasons[1]!.id)

    // Retirar: el entrenador deja de ver el equipo; el último administrador no se puede retirar.
    const remove = (email: string) => runSql('05_retirar_entrenador_del_equipo.sql', { '<EMAIL_DEL_ENTRENADOR>': email, '<ID_DEL_EQUIPO>': team.id })
    remove(coach.email)
    expect(await loadMemberships(coach.client, coach.id)).toEqual([])
    expect(() => remove(admin.email)).toThrow(/último administrador/)
    expect(() => remove(coach.email)).toThrow(/no pertenece/)
  })

  it('00 · comprobación de la instalación: seguridad correcta (en local hay datos, así que "vacía" no)', () => {
    const output = runSql('00_comprobar_instalacion.sql')
    const rows = output
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((cells) => cells.length === 3 && (cells[1] === 't' || cells[1] === 'f'))
    const byName = new Map(rows.map(([name, ok]) => [name, ok]))
    for (const name of [
      'RLS activo en todas las tablas de public',
      'RLS activo en las tablas internas (private)',
      'append_match_events: solo usuarios con sesión',
      'take_match_control: solo usuarios con sesión',
      'server_time: solo usuarios con sesión',
      'set_event_time_policy: solo la clave de servicio',
      'La validación interna de eventos no es accesible desde la API',
      'Historial de eventos inmutable (triggers)',
      'Tolerancia de horas futuras de producción (60 s)',
      'Bucket de escudos privado',
    ]) {
      expect(byName.get(name), name).toBe('t')
    }
    expect(byName.has('Sin equipos (instalación vacía)')).toBe(true)
    expect(byName.has('Ningún dato DEMO')).toBe(true)
  })

  it('09 · borrar el equipo de PRUEBAS con sus partidos y eventos; nunca un equipo real', async () => {
    const teamName = `PRUEBAS puesta en marcha ${randomUUID().slice(0, 8)}`
    runSql('01_crear_equipo_y_temporada.sql', { '<NOMBRE_DEL_EQUIPO>': teamName, '<TEMPORADA_AAAA-AA>': '2026-27' })
    const team = await teamByName(teamName)
    const coach = await createUser('Prueba')
    runSql('04_anadir_entrenador_al_equipo.sql', {
      '<EMAIL_DEL_ENTRENADOR>': coach.email,
      '<ID_DEL_EQUIPO>': team.id,
      '<coach o admin>': 'admin',
      '<NOMBRE_VISIBLE>': 'Entrenador de prueba',
    })
    // Un partido jugado de verdad (eventos en el servidor).
    const players = await createPlayers(coach, team.id, 14)
    const matchId = randomUUID()
    must(await coach.client.from('matches').insert({ id: matchId, team_id: team.id, season_id: team.current_season_id!, opponent: 'Rival' }))
    must(await coach.client.from('match_squads').insert({ match_id: matchId, team_id: team.id, player_ids: players }))
    const device = new MatchHarness(matchId, randomUUID)
    device.squad = players
    device.deviceId = 'movil-de-pruebas'
    device.now = Date.now() - 30 * 60_000
    device.kickOff(lineupOf('4-3-3', players.slice(0, 11)))
    expect((await append(coach, matchId, device.events)).rejected).toBeNull()

    // Un equipo real (sin "PRUEBAS") no se puede borrar con este script.
    const realName = `Equipo real ${randomUUID().slice(0, 8)}`
    runSql('01_crear_equipo_y_temporada.sql', { '<NOMBRE_DEL_EQUIPO>': realName, '<TEMPORADA_AAAA-AA>': '2026-27' })
    const real = await teamByName(realName)
    expect(() => runSql('09_borrar_equipo_de_pruebas.sql', { '<ID_DEL_EQUIPO_DE_PRUEBAS>': real.id })).toThrow(/no es de pruebas/)
    expect(() => runSql('09_borrar_equipo_de_pruebas.sql')).toThrow(/Sustituye/)

    const output = runSql('09_borrar_equipo_de_pruebas.sql', { '<ID_DEL_EQUIPO_DE_PRUEBAS>': team.id })
    expect(output).toMatch(/historial_protegido\s*-+\s*t/)
    const admin = serviceClient()
    expect(must(await admin.from('teams').select('id').eq('id', team.id)).data).toEqual([])
    expect(must(await admin.from('match_events').select('id').eq('match_id', matchId)).data).toEqual([])
    expect(must(await admin.from('players').select('id').eq('team_id', team.id)).data).toEqual([])
    // Ya sin eventos, la cuenta de prueba se puede borrar (como en el panel).
    expect((await admin.auth.admin.deleteUser(coach.id)).error).toBeNull()
    // El historial sigue protegido para todos los demás equipos (un partido con eventos reales).
    const other = await matchScenario()
    other.device.now = Date.now() - 30 * 60_000
    other.device.kickOff(other.lineup)
    await other.sync()
    expectError(await admin.from('match_events').delete().eq('match_id', other.matchId), 'MATCH_EVENTS_ARE_IMMUTABLE')
    expect(must(await admin.from('match_events').select('id').eq('match_id', other.matchId)).data).toHaveLength(other.device.events.length)
  })
})
