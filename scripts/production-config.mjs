// Genera el bloque [remotes.production] de supabase/config.toml a partir de la plantilla
// supabase/remotes/production.toml.template (3e.2). Solo escribe ficheros locales: NO se conecta
// a Supabase. Después: `supabase config diff` (revisar) y `supabase config push` (confirmar).
//
//   node scripts/production-config.mjs --project-ref <ref> --app-url https://<app>.vercel.app [--print]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TEMPLATE = new URL('../supabase/remotes/production.toml.template', import.meta.url)
const CONFIG = new URL('../supabase/config.toml', import.meta.url)

/** Bloque de configuración de producción (función pura, probada en los tests). */
export function renderProductionConfig({ projectRef, appUrl }, template = readFileSync(TEMPLATE, 'utf8')) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new Error('El project ref son 20 letras minúsculas (Settings → General).')
  const url = (appUrl ?? '').replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('La URL de la app debe ser https://<dominio> (sin ruta).')
  const body = template
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim()
  return `${body.replaceAll('__PROJECT_REF__', projectRef).replaceAll('__APP_URL__', url)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name) => {
    const index = process.argv.indexOf(`--${name}`)
    return index > 0 ? process.argv[index + 1] : undefined
  }
  const block = renderProductionConfig({ projectRef: argument('project-ref'), appUrl: argument('app-url') })
  if (process.argv.includes('--print')) {
    process.stdout.write(block)
  } else {
    const config = readFileSync(CONFIG, 'utf8')
    if (config.includes('[remotes.production]')) {
      console.error('supabase/config.toml ya tiene [remotes.production]: revísalo a mano.')
      process.exit(1)
    }
    writeFileSync(CONFIG, `${config.trimEnd()}\n\n# Producción (generado con scripts/production-config.mjs)\n${block}`)
    console.log('✓ Añadido [remotes.production] a supabase/config.toml. Siguiente: npx supabase config diff')
  }
}
