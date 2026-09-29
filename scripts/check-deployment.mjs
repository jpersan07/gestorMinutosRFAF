// Comprueba una app PUBLICADA (o servida en local) SIN iniciar sesión, SIN escribir datos y SIN
// llamar a Supabase: solo peticiones GET a la propia URL de la app.
//
//   npm run check:deploy -- https://<app>.vercel.app [--expect-supabase https://<ref>.supabase.co]
//   npm run check:deploy -- http://localhost:4174 --expect-supabase http://127.0.0.1:54321
//   npm run check:deploy -- http://localhost:4173 --no-headers      (p. ej. `vite preview`)
//   npm run check:deploy -- https://<preview>.vercel.app --forbid-supabase https://<ref>.supabase.co
//                                                    (una preview NO debe apuntar a producción)
//
// Sale con código 1 si alguna comprobación falla.
import { fileURLToPath } from 'node:url'

const REQUIRED_CSP = ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]

function looksLikeSecret(code) {
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(code)) return true
  for (const jwt of code.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).role === 'service_role') return true
    } catch {
      // No es un JWT válido.
    }
  }
  return false
}

const attr = (tag, name) => new RegExp(`${name}="([^"]+)"`).exec(tag)?.[1]
const revalidates = (value) => /no-cache|no-store|max-age=0|must-revalidate/.test(value ?? '')

/**
 * @param {string} baseUrl
 * @param {{ requireHeaders?: boolean, expectSupabase?: string, fetch?: typeof fetch }} options
 */
export async function checkDeployment(baseUrl, options = {}) {
  const { requireHeaders = true, expectSupabase, forbidSupabase = [] } = options
  const get = options.fetch ?? fetch
  const base = new URL(baseUrl)
  const at = (path) => new URL(path, base).toString()
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })

  // 1. La app responde con su HTML.
  const home = await get(at('/'))
  const html = await home.text()
  check('La app responde (/)', home.status === 200 && /text\/html/.test(home.headers.get('content-type') ?? ''), `HTTP ${home.status}`)
  check('HTML principal de la app', html.includes('id="root"'))

  // 2. HTTPS (si la URL es https y no es local).
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if (base.protocol === 'https:') {
    check('Se sirve por HTTPS', new URL(home.url || base).protocol === 'https:')
    if (!local) {
      const insecure = new URL(base)
      insecure.protocol = 'http:'
      const plain = await get(insecure.toString(), { redirect: 'manual' })
      const location = plain.headers.get('location') ?? ''
      check('http:// redirige a https://', plain.status >= 300 && plain.status < 400 && location.startsWith('https://'), `HTTP ${plain.status} → ${location}`)
    }
  } else if (!local) {
    check('Se sirve por HTTPS', false, 'la URL no es https')
  }

  // 3. Cabeceras de seguridad y de caché del documento.
  if (requireHeaders) {
    const csp = home.headers.get('content-security-policy') ?? ''
    for (const directive of REQUIRED_CSP) check(`CSP incluye ${directive}`, csp.includes(directive))
    check('CSP permite conectar con Supabase', /connect-src [^;]*(supabase\.co|127\.0\.0\.1|localhost)/.test(csp), csp.match(/connect-src [^;]*/)?.[0] ?? '')
    check('X-Content-Type-Options: nosniff', home.headers.get('x-content-type-options') === 'nosniff')
    check('Referrer-Policy', Boolean(home.headers.get('referrer-policy')))
    check('Permissions-Policy', Boolean(home.headers.get('permissions-policy')))
    if (base.protocol === 'https:') check('Strict-Transport-Security', /max-age=\d+/.test(home.headers.get('strict-transport-security') ?? ''))
    check('El HTML se revalida (versiones nuevas)', revalidates(home.headers.get('cache-control')), home.headers.get('cache-control') ?? '(sin cabecera)')
  }

  // 4. Recursos principales (JS y CSS) y código publicado sin claves secretas.
  const tags = html.match(/<(script|link)\b[^>]*>/g) ?? []
  const scripts = tags.filter((t) => t.startsWith('<script')).map((t) => attr(t, 'src')).filter(Boolean)
  const styles = tags.filter((t) => /rel="stylesheet"/.test(t)).map((t) => attr(t, 'href')).filter(Boolean)
  check('El HTML enlaza el código de la app', scripts.length > 0)
  let bundle = ''
  for (const src of [...scripts, ...styles]) {
    const response = await get(at(src))
    const body = await response.text()
    if (src.endsWith('.js')) bundle += body
    check(`Recurso ${src}`, response.status === 200, `HTTP ${response.status}`)
    if (requireHeaders && src.startsWith('/assets/')) {
      check(`Caché larga en ${src}`, /immutable|max-age=31536000/.test(response.headers.get('cache-control') ?? ''))
    }
  }
  check('El código publicado no contiene claves secretas', !looksLikeSecret(bundle))
  const supabaseUrls = [...new Set(bundle.match(/https:\/\/[a-z0-9]{20}\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321/g) ?? [])]
  for (const forbidden of forbidSupabase) {
    check(`La app NO apunta a ${forbidden}`, !bundle.includes(forbidden.replace(/\/+$/, '')))
  }
  if (expectSupabase) {
    check(`La app apunta a ${expectSupabase}`, supabaseUrls.includes(expectSupabase.replace(/\/+$/, '')), supabaseUrls.join(', ') || '(ninguna)')
  }
  if (!local) {
    check('No apunta a un Supabase local', !supabaseUrls.some((u) => u.startsWith('http://')), supabaseUrls.join(', '))
    if (requireHeaders && expectSupabase) {
      // En producción la CSP se restringe al proyecto real (npm run prod:csp): sin comodines.
      const connect = home.headers.get('content-security-policy')?.match(/connect-src [^;]*/)?.[0] ?? ''
      check(`CSP restringida a ${expectSupabase}`, connect.split(/\s+/).includes(expectSupabase.replace(/\/+$/, '')) && !connect.includes('*'), connect)
    }
  }

  // 5. PWA: manifest (instalable) y service worker.
  const manifestHref = attr(tags.find((t) => /rel="manifest"/.test(t)) ?? '', 'href')
  check('El HTML declara el manifest', Boolean(manifestHref))
  if (manifestHref) {
    const response = await get(at(manifestHref))
    let manifest = {}
    try {
      manifest = await response.json()
    } catch {
      // Se informa abajo.
    }
    const icons = manifest.icons ?? []
    check('Manifest PWA', response.status === 200 && Boolean(manifest.name) && manifest.display === 'standalone' && Boolean(manifest.start_url))
    check('Iconos 192 y 512 para instalar', icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512'))
    for (const icon of icons) {
      const iconResponse = await get(at(icon.src))
      check(`Icono ${icon.src}`, iconResponse.status === 200, `HTTP ${iconResponse.status}`)
    }
  }
  const sw = await get(at('/sw.js'))
  await sw.text()
  check('Service worker (/sw.js)', sw.status === 200 && /javascript/.test(sw.headers.get('content-type') ?? ''), `HTTP ${sw.status}`)
  if (requireHeaders) check('El service worker se revalida', revalidates(sw.headers.get('cache-control')), sw.headers.get('cache-control') ?? '(sin cabecera)')

  // 6. Rutas de la SPA (enlace del correo de recuperación) y recursos inexistentes.
  const recovery = await get(at('/restablecer?token_hash=comprobacion&type=recovery'))
  check('Ruta /restablecer (enlace del correo)', recovery.status === 200 && (await recovery.text()).includes('id="root"'))
  const missing = await get(at(`/assets/no-existe-${Date.now()}.js`))
  await missing.text()
  check('Un recurso inexistente da 404 (no la app)', missing.status === 404, `HTTP ${missing.status}`)

  return { ok: checks.every((c) => c.ok), checks, supabaseUrls }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const url = args.find((a, i) => /^https?:\/\//.test(a) && !['--expect-supabase', '--forbid-supabase'].includes(args[i - 1]))
  if (!url) {
    console.error('Uso: npm run check:deploy -- <url de la app> [--expect-supabase <url>] [--no-headers]')
    process.exit(2)
  }
  const expectIndex = args.indexOf('--expect-supabase')
  const result = await checkDeployment(url, {
    requireHeaders: !args.includes('--no-headers'),
    expectSupabase: expectIndex >= 0 ? args[expectIndex + 1] : undefined,
    forbidSupabase: args.flatMap((a, i) => (args[i - 1] === '--forbid-supabase' ? [a] : [])),
  })
  for (const c of result.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail && !c.ok ? ` — ${c.detail}` : ''}`)
  console.log(result.ok ? `\nTodo correcto en ${url}` : `\nHay comprobaciones que fallan en ${url}`)
  process.exit(result.ok ? 0 : 1)
}
