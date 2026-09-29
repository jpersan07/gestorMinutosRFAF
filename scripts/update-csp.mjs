// Ajusta `connect-src` de la CSP de vercel.json a los Supabase REALES declarados en
// deploy/production.json (y deploy/staging.json, si hay staging para las previews).
// Mientras producción no esté declarada, se mantiene `https://*.supabase.co`.
//
//   npm run prod:csp            (después: revisar el cambio, npm run test:e2e:prodlike y commit)
//
// Solo cambia vercel.json en local: no se conecta a ningún servicio.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const VERCEL = new URL('../vercel.json', import.meta.url)
const read = (file) => JSON.parse(readFileSync(new URL(`../deploy/${file}`, import.meta.url), 'utf8'))

const origin = (url) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !/^[a-z]{20}\.supabase\.co$/.test(parsed.host)) {
    throw new Error(`${url} no es la URL de un proyecto de Supabase (https://<20 letras>.supabase.co).`)
  }
  return parsed.origin
}

/** Orígenes que la app puede usar con fetch: la propia app y los Supabase declarados. */
export function connectSources(production, staging = { supabaseUrl: null }) {
  if (!production.supabaseUrl) return ["'self'", 'https://*.supabase.co']
  return ["'self'", origin(production.supabaseUrl), ...(staging.supabaseUrl ? [origin(staging.supabaseUrl)] : [])]
}

/** CSP con connect-src sustituido. */
export function withConnectSources(csp, sources) {
  return csp.replace(/connect-src [^;]*/, `connect-src ${sources.join(' ')}`)
}

export function expectedVercelConfig(config = JSON.parse(readFileSync(VERCEL, 'utf8')), production = read('production.json'), staging = read('staging.json')) {
  const sources = connectSources(production, staging)
  return {
    ...config,
    headers: config.headers.map((rule) => ({
      ...rule,
      headers: rule.headers.map((h) => (h.key === 'Content-Security-Policy' ? { ...h, value: withConnectSources(h.value, sources) } : h)),
    })),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = expectedVercelConfig()
  writeFileSync(VERCEL, `${JSON.stringify(next, null, 2)}\n`)
  const csp = next.headers.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy')
  console.log(`✓ vercel.json: ${csp.value.match(/connect-src [^;]*/)[0]}`)
}
