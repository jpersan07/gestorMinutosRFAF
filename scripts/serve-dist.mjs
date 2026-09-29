// Sirve `dist` como lo haría Vercel con vercel.json: primero los ficheros que existen, después
// las reescrituras (fallback de la SPA) y, en todas las respuestas, las cabeceras declaradas
// (CSP incluida). Sirve para probar EN LOCAL la configuración de producción antes de publicar.
//
//   node scripts/serve-dist.mjs --port 4174 [--supabase-origin http://127.0.0.1:54321] [--csp-reports]
//
// --supabase-origin sustituye los Supabase de `connect-src` en la CSP (`https://*.supabase.co` o el
// origen exacto de producción) por el Supabase local: es la única diferencia con producción. Solo lee ficheros: no escribe nada en ningún sitio.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * `source` de vercel.json (sintaxis path-to-regexp con grupos de expresión regular) → RegExp.
 * Fuera de los paréntesis todo es literal; dentro, expresión regular.
 */
export function sourceToRegExp(source) {
  let depth = 0
  let pattern = ''
  for (const char of source) {
    if (char === '(') depth++
    if (depth === 0) pattern += char.replace(/[.*+?^${}|[\]\\]/g, '\\$&')
    else pattern += char
    if (char === ')') depth--
  }
  return new RegExp(`^${pattern}$`)
}

export function loadVercelConfig(path = new URL('../vercel.json', import.meta.url)) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Cabeceras que Vercel añadiría a esta ruta (todas las reglas que coinciden, en orden). */
export function headersFor(config, pathname, options = {}) {
  const headers = {}
  for (const rule of config.headers ?? []) {
    if (!sourceToRegExp(rule.source).test(pathname)) continue
    for (const { key, value } of rule.headers) {
      headers[key] =
        key === 'Content-Security-Policy' && options.supabaseOrigin
          ? value.replace(/connect-src [^;]*/, `connect-src 'self' ${options.supabaseOrigin}`)
          : value
    }
  }
  return headers
}

/** Fichero de `dir` que corresponde a la ruta (null si no existe). Nunca sale de `dir`. */
function fileFor(dir, pathname) {
  const path = normalize(join(dir, decodeURIComponent(pathname)))
  if (!path.startsWith(dir)) return null
  if (existsSync(path) && statSync(path).isFile()) return path
  return null
}

/**
 * `cspReports`: SOLO para las pruebas locales, añade `report-uri` a la CSP y guarda las
 * violaciones que envíe el navegador (POST /__csp-report); se consultan en GET /__csp-reports.
 */
export function createDistServer({ dir = 'dist', config = loadVercelConfig(), supabaseOrigin, cspReports = false } = {}) {
  const root = resolve(dir)
  const reports = []
  return createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost')
    if (cspReports && pathname === '/__csp-report' && request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        reports.push(body)
        response.writeHead(204).end()
      })
      return
    }
    if (cspReports && pathname === '/__csp-reports') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reports))
      return
    }
    let file = fileFor(root, pathname === '/' ? '/index.html' : pathname)
    if (!file) {
      const rewrite = (config.rewrites ?? []).find((r) => sourceToRegExp(r.source).test(pathname))
      if (rewrite) file = fileFor(root, rewrite.destination)
    }
    const headers = headersFor(config, pathname, { supabaseOrigin })
    if (cspReports && headers['Content-Security-Policy']) {
      headers['Content-Security-Policy'] += '; report-uri /__csp-report'
    }
    if (!file) {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('404')
      return
    }
    response.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    response.end(request.method === 'HEAD' ? undefined : readFileSync(file))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name) => {
    const index = process.argv.indexOf(`--${name}`)
    return index > 0 ? process.argv[index + 1] : undefined
  }
  const port = Number(argument('port') ?? 4174)
  const server = createDistServer({
    dir: argument('dir') ?? 'dist',
    supabaseOrigin: argument('supabase-origin'),
    cspReports: process.argv.includes('--csp-reports'),
  })
  server.listen(port, () => console.log(`dist (como en Vercel) en http://localhost:${port}`))
}
