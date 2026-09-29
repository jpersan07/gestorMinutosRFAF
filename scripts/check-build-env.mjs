// Comprobación de variables ANTES de compilar (vercel.json → buildCommand) y, otra vez, dentro
// del propio build de Vite (vite.config.ts), por si alguien cambia el comando en el panel.
//
// Separa los entornos (D-E6):
//   · Production (VERCEL_ENV=production): EXACTAMENTE el Supabase de producción declarado en
//     deploy/production.json, con la configuración completa;
//   · Preview / Development de Vercel: NUNCA producción. O sin Supabase (la app muestra "Falta
//     configuración" y no lee ni escribe nada) o el proyecto de STAGING declarado en
//     deploy/staging.json. Cualquier otra URL se rechaza;
//   · fuera de Vercel (desarrollo local, CI): solo se comprueba que no haya secretos.
// En TODOS los entornos: ninguna variable VITE_* (que acaba dentro de la app) puede contener un
// secreto: ni claves secretas de Supabase, ni service_role, ni contraseñas o credenciales SMTP.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Clave secreta de Supabase (sb_secret_…) o JWT con rol service_role. */
export function isSecretKey(value) {
  const key = String(value ?? '').trim()
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

/** Nombres de variable que indican un secreto: nunca pueden ir en VITE_*. */
const SECRET_NAME = /SECRET|SERVICE_ROLE|PASSWORD|PASSWD|PASS$|_PASS_|TOKEN|PRIVATE|SMTP|DB_URL|DATABASE_URL/i

const normalize = (url) => (url ? String(url).trim().replace(/\/+$/, '').toLowerCase() : '')
const hostOf = (url) => {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).host.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Devuelve la lista de problemas (vacía si todo está bien). Función pura para poder probarla.
 * @param {Record<string, string | undefined>} env
 * @param {{ supabaseUrl: string | null, appUrl?: string | null }} production
 * @param {{ supabaseUrl: string | null }} [staging]
 */
export function checkBuildEnv(env, production, staging = { supabaseUrl: null }) {
  const problems = []

  // 1. Ningún secreto en variables que acaban dentro de la app.
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || value === undefined || value === '') continue
    if (SECRET_NAME.test(name.slice(5))) problems.push(`${name}: las variables VITE_* acaban dentro de la app; ningún secreto puede ir en ellas.`)
    else if (isSecretKey(value)) problems.push(`${name} contiene una clave SECRETA (sb_secret_… o service_role): en la app solo va la clave publicable.`)
  }
  if (!env.VERCEL) return problems

  const url = normalize(env.VITE_SUPABASE_URL)
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  const productionUrl = normalize(production.supabaseUrl)
  const stagingUrl = normalize(staging.supabaseUrl)

  if (productionUrl && stagingUrl && productionUrl === stagingUrl) {
    problems.push('deploy/staging.json y deploy/production.json declaran el MISMO Supabase: staging debe ser otro proyecto.')
  }

  const target = env.VERCEL_ENV
  if (target === 'production') {
    if (!url || !key) problems.push('Production: faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_PUBLISHABLE_KEY.')
    if (url && !url.startsWith('https://')) problems.push('Production: VITE_SUPABASE_URL debe usar https.')
    if (!productionUrl) problems.push('Production: rellena "supabaseUrl" en deploy/production.json.')
    else if (url && url !== productionUrl) {
      problems.push('Production: VITE_SUPABASE_URL no es el Supabase de producción de deploy/production.json.')
    }
    if (!production.appUrl) problems.push('Production: rellena "appUrl" en deploy/production.json (la URL pública de la app).')
    else if (env.VERCEL_PROJECT_PRODUCTION_URL && hostOf(env.VERCEL_PROJECT_PRODUCTION_URL) !== hostOf(production.appUrl)) {
      problems.push(
        `Production: la URL de producción de Vercel (${env.VERCEL_PROJECT_PRODUCTION_URL}) no es "appUrl" de deploy/production.json; actualízalo (y las URLs de Auth de Supabase).`,
      )
    }
  } else if (url) {
    // Preview / Development: solo staging (declarado) o nada.
    if (productionUrl && url === productionUrl) {
      problems.push(`${target}: una preview NUNCA puede usar el Supabase de producción. Déjala sin variables o usa staging.`)
    } else if (!stagingUrl) {
      problems.push(`${target}: hay VITE_SUPABASE_URL pero deploy/staging.json no declara un proyecto de staging. Déjala sin variables o declara staging.`)
    } else if (url !== stagingUrl) {
      problems.push(`${target}: VITE_SUPABASE_URL no es el proyecto de staging de deploy/staging.json.`)
    }
    if (!productionUrl) {
      problems.push(`${target}: declara antes producción en deploy/production.json para poder comprobar que una preview no la usa.`)
    }
  }
  return problems
}

export function readDeployConfig() {
  const read = (file) => JSON.parse(readFileSync(new URL(`../deploy/${file}`, import.meta.url), 'utf8'))
  return { production: read('production.json'), staging: read('staging.json') }
}

/** Lanza si hay problemas (lo usa vite.config.ts en el build). */
export function assertBuildEnv(env) {
  const { production, staging } = readDeployConfig()
  const problems = checkBuildEnv(env, production, staging)
  if (problems.length > 0) {
    throw new Error(`Variables de entorno no válidas para este build:\n  · ${problems.join('\n  · ')}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { production, staging } = readDeployConfig()
  const problems = checkBuildEnv(process.env, production, staging)
  const where = process.env.VERCEL ? `Vercel (${process.env.VERCEL_ENV})` : 'local'
  if (problems.length > 0) {
    console.error(`✗ Variables de entorno no válidas para ${where}:`)
    for (const problem of problems) console.error(`  · ${problem}`)
    process.exit(1)
  }
  console.log(`✓ Variables de entorno correctas para ${where}.`)
}
