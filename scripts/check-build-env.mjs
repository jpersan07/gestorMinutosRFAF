// Comprobación de variables ANTES de compilar en Vercel (vercel.json → buildCommand).
//
// Separa los entornos (D-E6):
//   · production (VERCEL_ENV=production): debe apuntar EXACTAMENTE al Supabase de producción
//     declarado en deploy/production.json;
//   · preview / development de Vercel: NUNCA al Supabase de producción. Sin variables, la app
//     se publica igualmente y muestra "Falta configuración" (no puede escribir en ningún sitio);
//     para probar de verdad en una preview hace falta un Supabase de staging aparte;
//   · fuera de Vercel (desarrollo local, CI): no se comprueba nada.
// En cualquier entorno, la clave del cliente debe ser la PUBLICABLE: nunca una secreta.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Clave secreta de Supabase (sb_secret_…) o JWT con rol service_role. */
export function isSecretKey(key) {
  if (/^sb_secret_/.test(key)) return true
  const parts = key.split('.')
  if (parts.length === 3 && key.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      return payload.role === 'service_role'
    } catch {
      return false
    }
  }
  return false
}

const normalize = (url) => (url ? url.trim().replace(/\/+$/, '').toLowerCase() : '')

/** Devuelve la lista de problemas (vacía si todo está bien). Función pura para poder probarla. */
export function checkBuildEnv(env, production) {
  const problems = []
  const url = normalize(env.VITE_SUPABASE_URL)
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  const productionUrl = normalize(production.supabaseUrl)

  if (key && isSecretKey(key)) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY es una clave SECRETA: en la app solo va la clave publicable.')
  }
  if (!env.VERCEL) return problems

  const target = env.VERCEL_ENV
  if (target === 'production') {
    if (!url || !key) problems.push('Producción: faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY.')
    if (url && !url.startsWith('https://')) problems.push('Producción: VITE_SUPABASE_URL debe usar https.')
    if (!productionUrl) problems.push('Producción: rellena "supabaseUrl" en deploy/production.json.')
    else if (url && url !== productionUrl) {
      problems.push('Producción: VITE_SUPABASE_URL no es el Supabase de producción de deploy/production.json.')
    }
  } else if (url) {
    if (!productionUrl) {
      problems.push(`${target}: hay VITE_SUPABASE_URL pero deploy/production.json no declara producción; no se puede comprobar que no sea la de producción.`)
    } else if (url === productionUrl) {
      problems.push(`${target}: una preview NO puede usar el Supabase de producción. Usa un proyecto de staging o deja las variables vacías.`)
    }
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const production = JSON.parse(readFileSync(new URL('../deploy/production.json', import.meta.url), 'utf8'))
  const problems = checkBuildEnv(process.env, production)
  const where = process.env.VERCEL ? `Vercel (${process.env.VERCEL_ENV})` : 'local'
  if (problems.length > 0) {
    console.error(`✗ Variables de entorno no válidas para ${where}:`)
    for (const problem of problems) console.error(`  · ${problem}`)
    process.exit(1)
  }
  console.log(`✓ Variables de entorno correctas para ${where}.`)
}
