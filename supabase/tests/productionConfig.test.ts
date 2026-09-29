import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backup, insideRepository } from '../../scripts/backup-db.mjs'
import { renderProductionConfig } from '../../scripts/production-config.mjs'

// Preparación de producción que se puede comprobar SIN tocar ningún proyecto remoto.

describe('configuración de producción de Supabase ([remotes.production])', () => {
  const block = renderProductionConfig({ projectRef: 'abcdefghijklmnopqrst', appUrl: 'https://gestor-ejemplo.vercel.app/' })

  it('usa la URL de la app para el acceso y la recuperación, y nunca el seed DEMO', () => {
    expect(block).toContain('project_id = "abcdefghijklmnopqrst"')
    expect(block).toContain('site_url = "https://gestor-ejemplo.vercel.app"')
    expect(block).toContain('additional_redirect_urls = ["https://gestor-ejemplo.vercel.app/**"]')
    expect(block).toMatch(/\[remotes\.production\.db\.seed\]\s+enabled = false/)
    expect(block).not.toMatch(/127\.0\.0\.1|localhost|demo/i)
    // El SMTP se lee de variables de entorno: ningún secreto en el fichero.
    expect(block).toContain('pass = "env(SUPABASE_AUTH_SMTP_PASS)"')
  })

  it('rechaza datos que no son de producción', () => {
    expect(() => renderProductionConfig({ projectRef: 'gestor-minutos', appUrl: 'https://x.vercel.app' })).toThrow()
    expect(() => renderProductionConfig({ projectRef: 'abcdefghijklmnopqrst', appUrl: 'http://x.vercel.app' })).toThrow()
  })

  it('la CLI de Supabase acepta config.toml con ese bloque (sin conectarse a ningún proyecto)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gestor-config-'))
    try {
      cpSync('supabase', join(dir, 'supabase'), { recursive: true, filter: (src) => !src.includes('/tests') })
      const config = join(dir, 'supabase', 'config.toml')
      const base = readFileSync(config, 'utf8').replace('project_id = "gestor-minutos"', 'project_id = "gestor-config-test"')
      writeFileSync(config, `${base}\n${block}`)
      let output = ''
      try {
        output = execFileSync('npx', ['supabase', 'status', '--workdir', dir, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        output = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`
      }
      // Lee la configuración y solo falla después, al no encontrar contenedores de ese proyecto.
      expect(output).not.toMatch(/failed to read config|Invalid config/i)
      expect(output).toMatch(/No such container|not running|gestor-config-test/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('copia de seguridad manual (supabase db dump)', () => {
  it('nunca dentro del repositorio', () => {
    expect(insideRepository('.')).toBe(true)
    expect(insideRepository('supabase/copias')).toBe(true)
    expect(insideRepository(tmpdir())).toBe(false)
    expect(() => backup({ source: '--local', out: 'copias' })).toThrow(/dentro del repositorio/)
  })

  it('copia local completa: roles, esquema y datos con sumas de comprobación', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gestor-backup-'))
    try {
      const result = backup({ source: '--local', out: dir })
      expect(result.files).toEqual(['roles.sql', 'schema.sql', 'data.sql'])
      expect(readFileSync(join(dir, 'schema.sql'), 'utf8')).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."match_events"/)
      expect(readFileSync(join(dir, 'data.sql'), 'utf8')).toMatch(/COPY "public"\."match_events"/)
      execFileSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: dir, stdio: 'ignore' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
