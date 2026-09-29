import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkBuildEnv, isSecretKey, readDeployConfig } from '../check-build-env.mjs'
import { checkDeployment } from '../check-deployment.mjs'
import { createDistServer, headersFor, loadVercelConfig, sourceToRegExp } from '../serve-dist.mjs'
import { connectSources, expectedVercelConfig } from '../update-csp.mjs'

const config = loadVercelConfig()
// Claves FALSAS construidas por partes (así ningún escáner de secretos las confunde con reales).
const FAKE_SECRET = ['sb', 'secret', '0123456789abcdefghij'].join('_')
const jwt = (payload) =>
  ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'firma-de-prueba-123'].join('.')

describe('vercel.json', () => {
  const csp = headersFor(config, '/')['Content-Security-Policy']

  it('cabeceras de seguridad en el documento, las rutas de la SPA y los recursos', () => {
    for (const path of ['/', '/partidos/abc/juego', '/restablecer', '/assets/index-abc.js', '/sw.js']) {
      const headers = headersFor(config, path)
      expect(headers['Content-Security-Policy'], path).toBe(csp)
      expect(headers['Strict-Transport-Security'], path).toMatch(/max-age=\d{7,}/)
      expect(headers['X-Content-Type-Options'], path).toBe('nosniff')
      expect(headers['Referrer-Policy'], path).toBe('strict-origin-when-cross-origin')
      expect(headers['Permissions-Policy'], path).toBeTruthy()
    }
  })

  it('CSP estricta: sin inline ni eval; solo la propia app y Supabase', () => {
    const directives = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))
    expect(directives['default-src']).toEqual(["'self'"])
    expect(directives['script-src']).toEqual(["'self'"])
    expect(directives['connect-src']).toEqual(["'self'", 'https://*.supabase.co'])
    expect(directives['img-src']).toEqual(["'self'", 'data:']) // escudos en data URL
    expect(directives['frame-ancestors']).toEqual(["'none'"])
    expect(directives['object-src']).toEqual(["'none'"])
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*;|http:/)
  })

  it('la pantalla siempre encendida del partido no se desactiva (Permissions-Policy)', () => {
    expect(headersFor(config, '/')['Permissions-Policy']).not.toMatch(/screen-wake-lock/)
  })

  it('caché: recursos con hash inmutables; documento, service worker y manifest se revalidan', () => {
    expect(headersFor(config, '/assets/index-abc.js')['Cache-Control']).toBe('public, max-age=31536000, immutable')
    for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/partidos/x']) {
      expect(headersFor(config, path)['Cache-Control'], path).toBe('public, max-age=0, must-revalidate')
    }
  })

  it('rutas: la SPA responde en cualquier ruta salvo en /assets (un recurso que falta da 404)', () => {
    const rewrite = config.rewrites[0]
    expect(rewrite.destination).toBe('/index.html')
    expect(sourceToRegExp(rewrite.source).test('/restablecer')).toBe(true)
    expect(sourceToRegExp(rewrite.source).test('/partidos/abc/juego')).toBe(true)
    expect(sourceToRegExp(rewrite.source).test('/assets/no-existe.js')).toBe(false)
  })

  it('el build de Vercel comprueba antes las variables de entorno', () => {
    expect(config.buildCommand).toBe('node scripts/check-build-env.mjs && npm run build')
    expect(config.outputDirectory).toBe('dist')
  })
})

describe('variables de entorno del build (producción / preview / local)', () => {
  const production = { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', appUrl: 'https://gestor-minutos.vercel.app' }
  const staging = { supabaseUrl: 'https://zyxwvutsrqponmlkjihg.supabase.co' }
  const noStaging = { supabaseUrl: null }
  const publishable = 'sb_publishable_0123456789abcdefghij'
  const prodVars = { VITE_SUPABASE_URL: production.supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: publishable }

  it('detecta claves secretas', () => {
    expect(isSecretKey(FAKE_SECRET)).toBe(true)
    expect(isSecretKey(jwt({ role: 'service_role' }))).toBe(true)
    expect(isSecretKey(jwt({ role: 'anon' }))).toBe(false)
    expect(isSecretKey(publishable)).toBe(false)
  })

  it('en CUALQUIER entorno, ningún secreto en variables VITE_* (van dentro de la app)', () => {
    expect(checkBuildEnv({}, production)).toEqual([])
    expect(checkBuildEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_SECRET }, production)).toHaveLength(1)
    expect(checkBuildEnv({ VITE_OTRA: jwt({ role: 'service_role' }) }, production)).toHaveLength(1)
    for (const name of ['VITE_SUPABASE_SECRET_KEY', 'VITE_SERVICE_ROLE_KEY', 'VITE_SMTP_PASS', 'VITE_SMTP_USER', 'VITE_DB_PASSWORD', 'VITE_ACCESS_TOKEN']) {
      expect(checkBuildEnv({ [name]: 'valor' }, production), name).toHaveLength(1)
    }
    // Las variables que no son VITE_* no llegan a la app: no se tocan (p. ej. las de la CLI).
    expect(checkBuildEnv({ SUPABASE_AUTH_SMTP_PASS: 'x', SUPABASE_DB_PASSWORD: 'x' }, production)).toEqual([])
  })

  it('Production: exactamente el Supabase de producción y la configuración completa', () => {
    const vercel = { VERCEL: '1', VERCEL_ENV: 'production' }
    expect(checkBuildEnv({ ...vercel, ...prodVars }, production, staging)).toEqual([])
    expect(checkBuildEnv({ ...vercel, ...prodVars, VERCEL_PROJECT_PRODUCTION_URL: 'gestor-minutos.vercel.app' }, production)).toEqual([])
    expect(checkBuildEnv(vercel, production).length).toBeGreaterThan(0)
    expect(checkBuildEnv({ ...vercel, ...prodVars, VITE_SUPABASE_URL: staging.supabaseUrl }, production, staging)).toHaveLength(1)
    expect(checkBuildEnv({ ...vercel, ...prodVars }, { supabaseUrl: null, appUrl: production.appUrl })).toHaveLength(1)
    expect(checkBuildEnv({ ...vercel, ...prodVars }, { supabaseUrl: production.supabaseUrl, appUrl: null })).toHaveLength(1)
    // Un dominio nuevo en Vercel obliga a actualizar appUrl (y las URLs de Auth de Supabase).
    expect(checkBuildEnv({ ...vercel, ...prodVars, VERCEL_PROJECT_PRODUCTION_URL: 'minutos.ejemplo.es' }, production)).toHaveLength(1)
  })

  it('Preview: NUNCA producción; solo sin Supabase o con el staging declarado', () => {
    for (const VERCEL_ENV of ['preview', 'development']) {
      const preview = { VERCEL: '1', VERCEL_ENV }
      expect(checkBuildEnv(preview, production, noStaging)).toEqual([])
      expect(checkBuildEnv({ ...preview, VITE_SUPABASE_URL: staging.supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: publishable }, production, staging)).toEqual([])
      const toProduction = { ...preview, ...prodVars, VITE_SUPABASE_URL: `${production.supabaseUrl}/` }
      expect(checkBuildEnv(toProduction, production, staging)).toEqual([expect.stringContaining('NUNCA puede usar el Supabase de producción')])
      // Una URL cualquiera (ni staging declarado ni producción): tampoco.
      expect(checkBuildEnv({ ...preview, ...prodVars, VITE_SUPABASE_URL: 'https://otroproyectoxxxxxxxxx.supabase.co' }, production, staging)).toHaveLength(1)
      expect(checkBuildEnv({ ...preview, ...prodVars, VITE_SUPABASE_URL: staging.supabaseUrl }, production, noStaging)).toHaveLength(1)
      // Sin producción declarada no se puede comprobar: se rechaza por prudencia.
      expect(checkBuildEnv({ ...preview, VITE_SUPABASE_URL: staging.supabaseUrl }, { supabaseUrl: null }, staging)).toHaveLength(1)
    }
    // Staging nunca puede ser el mismo proyecto que producción.
    expect(checkBuildEnv({ VERCEL: '1', VERCEL_ENV: 'preview' }, production, { supabaseUrl: production.supabaseUrl })).toHaveLength(1)
  })

  it('los ficheros deploy/*.json del repositorio son válidos y el build local pasa', () => {
    const { production: p, staging: s } = readDeployConfig()
    expect(Object.keys(p).sort()).toEqual(['$comment', 'appUrl', 'supabaseUrl'])
    expect(Object.keys(s).sort()).toEqual(['$comment', 'supabaseUrl'])
    expect(checkBuildEnv({}, p, s)).toEqual([])
  })
})

describe('CSP: connect-src se restringe al Supabase real cuando existe (npm run prod:csp)', () => {
  it('vercel.json es coherente con deploy/production.json y deploy/staging.json', () => {
    expect(expectedVercelConfig()).toEqual(config)
  })

  it('sin producción declarada, comodín; con producción (y staging), solo esos orígenes', () => {
    expect(connectSources({ supabaseUrl: null })).toEqual(["'self'", 'https://*.supabase.co'])
    expect(connectSources({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' })).toEqual(["'self'", 'https://abcdefghijklmnopqrst.supabase.co'])
    expect(
      connectSources({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co/' }, { supabaseUrl: 'https://zyxwvutsrqponmlkjihg.supabase.co' }),
    ).toEqual(["'self'", 'https://abcdefghijklmnopqrst.supabase.co', 'https://zyxwvutsrqponmlkjihg.supabase.co'])
    expect(() => connectSources({ supabaseUrl: 'http://127.0.0.1:54321' })).toThrow()
    const exact = expectedVercelConfig(config, { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' }, { supabaseUrl: null })
    const csp = exact.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value
    expect(csp).toContain("connect-src 'self' https://abcdefghijklmnopqrst.supabase.co;")
    expect(csp).not.toContain('*')
    // El resto de la CSP no cambia.
    expect(csp.replace(/connect-src [^;]*/, '')).toBe(headersFor(config, '/')['Content-Security-Policy'].replace(/connect-src [^;]*/, ''))
  })

  it('el servidor local sustituye el Supabase de la CSP (comodín u origen exacto) por el local', () => {
    const exact = expectedVercelConfig(config, { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' }, { supabaseUrl: null })
    for (const c of [config, exact]) {
      expect(headersFor(c, '/', { supabaseOrigin: 'http://127.0.0.1:54321' })['Content-Security-Policy']).toContain(
        "connect-src 'self' http://127.0.0.1:54321;",
      )
    }
  })
})

describe('comprobación de una URL publicada', () => {
  let dir
  const servers = []

  /** Mini "app" publicada: HTML, JS, CSS, manifest con iconos y service worker. */
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gestor-check-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest"><script type="module" crossorigin src="/assets/app.js"></script><link rel="stylesheet" crossorigin href="/assets/app.css"></head><body><div id="root"></div></body></html>',
    )
    writeFileSync(join(dir, 'assets', 'app.js'), 'const url = "https://abcdefghijklmnopqrst.supabase.co"; const key = "sb_publishable_0123456789abcdefghij";')
    writeFileSync(join(dir, 'assets', 'app.css'), 'body{}')
    writeFileSync(
      join(dir, 'manifest.webmanifest'),
      JSON.stringify({ name: 'Gestor de Minutos', start_url: '/', display: 'standalone', icons: [{ src: 'i192.png', sizes: '192x192' }, { src: 'i512.png', sizes: '512x512' }] }),
    )
    for (const icon of ['i192.png', 'i512.png']) writeFileSync(join(dir, icon), 'png')
    writeFileSync(join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {})')
  })

  afterAll(() => {
    for (const server of servers) server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const serve = async (options) => {
    const server = createDistServer({ dir, ...options })
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${server.address().port}`
  }

  it('con las cabeceras de vercel.json: todo correcto y detecta a qué Supabase apunta', async () => {
    const url = await serve({})
    const result = await checkDeployment(url, { expectSupabase: 'https://abcdefghijklmnopqrst.supabase.co' })
    expect(result.checks.filter((c) => !c.ok)).toEqual([])
    expect(result.supabaseUrls).toEqual(['https://abcdefghijklmnopqrst.supabase.co'])
  })

  it('sin cabeceras de seguridad: lo detecta (y con --no-headers lo omite)', async () => {
    const url = await serve({ config: { ...config, headers: [] } })
    const strict = await checkDeployment(url)
    expect(strict.ok).toBe(false)
    expect(strict.checks.filter((c) => !c.ok).map((c) => c.name)).toContain('X-Content-Type-Options: nosniff')
    expect((await checkDeployment(url, { requireHeaders: false })).ok).toBe(true)
  })

  it('URL real con --expect-supabase: exige la CSP restringida a ese proyecto (sin comodín)', async () => {
    const wildcard = await serve({})
    const exact = await serve({ config: expectedVercelConfig(config, { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' }, { supabaseUrl: null }) })
    // Simula una URL pública (https) redirigiendo las peticiones al servidor local.
    const as = (local) => (url, init) => fetch(String(url).replace(/^https?:\/\/app\.ejemplo\.es/, local), init)
    const strict = (result) => result.checks.find((c) => c.name === 'CSP restringida a https://abcdefghijklmnopqrst.supabase.co')
    const options = { expectSupabase: 'https://abcdefghijklmnopqrst.supabase.co' }
    expect(strict(await checkDeployment('https://app.ejemplo.es', { ...options, fetch: as(wildcard) }))?.ok).toBe(false)
    expect(strict(await checkDeployment('https://app.ejemplo.es', { ...options, fetch: as(exact) }))?.ok).toBe(true)
  })

  it('--forbid-supabase: comprueba que una preview NO apunta al Supabase de producción', async () => {
    const url = await serve({})
    const ok = await checkDeployment(url, { forbidSupabase: ['https://otroproyectoxxxxxxxxx.supabase.co'] })
    expect(ok.checks.find((c) => c.name.startsWith('La app NO apunta'))?.ok).toBe(true)
    const bad = await checkDeployment(url, { forbidSupabase: ['https://abcdefghijklmnopqrst.supabase.co/'] })
    expect(bad.checks.find((c) => c.name.startsWith('La app NO apunta'))?.ok).toBe(false)
  })

  it('una clave secreta en el código publicado o un Supabase inesperado: falla', async () => {
    writeFileSync(join(dir, 'assets', 'app.js'), `const key = "${jwt({ role: 'service_role' })}"; const url = "http://127.0.0.1:54321"`)
    const url = await serve({})
    const result = await checkDeployment(url, { expectSupabase: 'https://abcdefghijklmnopqrst.supabase.co' })
    const failed = result.checks.filter((c) => !c.ok).map((c) => c.name)
    expect(failed).toContain('El código publicado no contiene claves secretas')
    expect(failed).toContain('La app apunta a https://abcdefghijklmnopqrst.supabase.co')
  })
})
