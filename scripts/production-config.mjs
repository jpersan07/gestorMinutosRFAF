// Genera el bloque [remotes.production] de supabase/config.toml a partir de la plantilla
// supabase/remotes/production.toml.template (3e.2). Solo escribe ficheros locales: NO se conecta
// a Supabase. Después: `supabase config diff` (revisar) y `supabase config push` (confirmar).
//
//   node scripts/production-config.mjs --project-ref <ref> --app-url https://<app>.vercel.app [--without-smtp] [--replace]
//        [--remote staging --preview-redirect 'https://<proyecto>-*.vercel.app/**'] [--print]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TEMPLATE = new URL('../supabase/remotes/production.toml.template', import.meta.url)
const CONFIG = new URL('../supabase/config.toml', import.meta.url)

/** Bloque de configuración de producción (función pura, probada en los tests). */
export function renderProductionConfig({ projectRef, appUrl, remote = 'production', previewRedirect, smtp = true }, template = readFileSync(TEMPLATE, 'utf8')) {
  if (!/^[a-z]{20}$/.test(projectRef ?? '')) throw new Error('El project ref son 20 letras minúsculas (Settings → General).')
  if (remote !== 'production' && remote !== 'staging') throw new Error('--remote debe ser production o staging.')
  const url = (appUrl ?? '').replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('La URL de la app debe ser https://<dominio> (sin ruta).')
  // Staging (previews): además, el patrón de las URLs de preview de Vercel, que cambian en cada
  // despliegue (p. ej. https://gestor-minutos-*.vercel.app/**). Nunca en producción.
  if (previewRedirect !== undefined) {
    if (remote !== 'staging') throw new Error('--preview-redirect solo se admite con --remote staging.')
    if (!/^https:\/\/[a-z0-9.*-]+\/\*\*$/i.test(previewRedirect)) throw new Error('--preview-redirect debe ser https://<patrón>.vercel.app/**')
  }
  const body = template
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim()
  // Sin SMTP (Paso 4): se omiten el correo propio y su límite (Supabase solo permite cambiarlo con SMTP).
  const sections = body.split(/\n(?=\[)/)
  const kept = smtp ? sections : sections.filter((section) => !/^\[remotes\.__REMOTE__\.auth\.(email\.smtp|rate_limit)\]/.test(section))
  const rendered = kept
    .join('\n')
    .replaceAll('__REMOTE__', remote)
    .replaceAll('__PROJECT_REF__', projectRef)
    .replaceAll('__APP_URL__', url)
  return `${previewRedirect ? rendered.replace(`["${url}/**"]`, `["${url}/**", "${previewRedirect}"]`) : rendered}\n`
}

/** Quita de config.toml el bloque que generó este script para ese remoto (para --replace). */
export function removeGeneratedBlock(config, remote) {
  const marker = `# ${remote} (generado con scripts/production-config.mjs)`
  const start = config.indexOf(marker)
  if (start < 0) return config
  const lines = config.slice(start).split('\n')
  let end = 1
  while (end < lines.length) {
    const line = lines[end]
    const other = line.startsWith('[') && !line.startsWith(`[remotes.${remote}]`) && !line.startsWith(`[remotes.${remote}.`)
    if (other || (line.startsWith('# ') && line.includes('(generado con scripts/production-config.mjs)'))) break
    end++
  }
  return `${config.slice(0, start).trimEnd()}\n${lines.slice(end).join('\n')}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name) => {
    const index = process.argv.indexOf(`--${name}`)
    return index > 0 ? process.argv[index + 1] : undefined
  }
  const remote = argument('remote') ?? 'production'
  const block = renderProductionConfig({
    projectRef: argument('project-ref'),
    appUrl: argument('app-url'),
    remote,
    previewRedirect: argument('preview-redirect'),
    smtp: !process.argv.includes('--without-smtp'),
  })
  if (process.argv.includes('--print')) {
    process.stdout.write(block)
  } else {
    let config = readFileSync(CONFIG, 'utf8')
    const marker = `# ${remote} (generado con scripts/production-config.mjs)`
    if (config.includes(`[remotes.${remote}]`)) {
      if (!process.argv.includes('--replace') || !config.includes(marker)) {
        console.error(`supabase/config.toml ya tiene [remotes.${remote}]: usa --replace (solo si lo generó este script) o revísalo a mano.`)
        process.exit(1)
      }
      config = removeGeneratedBlock(config, remote)
    }
    writeFileSync(CONFIG, `${config.trimEnd()}\n\n${marker}\n${block}`)
    console.log(`✓ Añadido [remotes.${remote}] a supabase/config.toml. Siguiente: npx supabase config diff --project-ref ${argument('project-ref')}`)
  }
}
