import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadMemberships } from '../../src/data'
import { createUser, env, must, serviceClient } from './helpers'

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
      expect(sql, file).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/) // emails
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
})
