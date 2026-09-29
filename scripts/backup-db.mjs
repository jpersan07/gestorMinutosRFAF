// Copia de seguridad MANUAL de la base de datos con la CLI oficial de Supabase (`supabase db dump`).
//
//   npm run db:backup -- --linked                 (producción: proyecto enlazado con `supabase link`)
//   npm run db:backup -- --local                  (Supabase local, para probar)
//   npm run db:backup -- --linked --out <carpeta> (por defecto: ~/copias-gestor-minutos/<fecha>)
//
// Con --linked la CLI pide la contraseña de la base de datos (o la lee de SUPABASE_DB_PASSWORD).
// La copia se guarda SIEMPRE FUERA del repositorio (contiene datos personales: nunca a Git).
// Genera roles.sql, schema.sql y data.sql + SHA256SUMS. Los escudos (imágenes en Storage) no
// van en la copia de la base de datos: ver docs/GUIA_PUESTA_EN_MARCHA.md (Parte E).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** ¿Está `dir` dentro del repositorio? (Ahí nunca se guarda una copia.) */
export function insideRepository(dir, repo = REPO) {
  const path = relative(repo, resolve(dir))
  return path === '' || (!path.startsWith('..') && !path.startsWith('/'))
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)

export function backup({ source, out }) {
  if (source !== '--linked' && source !== '--local') throw new Error('Indica --linked (producción) o --local.')
  const dir = resolve(out ?? join(homedir(), 'copias-gestor-minutos', `${source.slice(2)}-${stamp()}`))
  if (insideRepository(dir)) throw new Error(`La copia no puede guardarse dentro del repositorio (${dir}).`)
  mkdirSync(dir, { recursive: true })

  const dumps = [
    ['roles.sql', ['--role-only']],
    ['schema.sql', []],
    ['data.sql', ['--data-only', '--use-copy']],
  ]
  const sums = []
  for (const [file, flags] of dumps) {
    const path = join(dir, file)
    execFileSync('npx', ['supabase', 'db', 'dump', source, ...flags, '-f', path], { stdio: ['inherit', 'ignore', 'inherit'] })
    if (!existsSync(path) || statSync(path).size === 0) throw new Error(`La copia ${file} está vacía o no existe.`)
    sums.push(`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${file}`)
  }
  writeFileSync(join(dir, 'SHA256SUMS'), `${sums.join('\n')}\n`)
  writeFileSync(
    join(dir, 'LEEME.txt'),
    [
      `Copia de la base de datos de Gestor de Minutos (${source.slice(2)}) — ${new Date().toISOString()}`,
      'Contiene datos personales: guárdala en un lugar privado y NUNCA en Git.',
      'Comprobar integridad:  sha256sum -c SHA256SUMS',
      'Restaurar: docs/GUIA_PUESTA_EN_MARCHA.md, Parte E (copias de seguridad).',
      '',
    ].join('\n'),
  )
  return { dir, files: dumps.map(([file]) => file) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  try {
    const result = backup({
      source: args.find((a) => a === '--linked' || a === '--local'),
      out: outIndex >= 0 ? args[outIndex + 1] : undefined,
    })
    console.log(`✓ Copia guardada en ${result.dir}`)
    for (const file of result.files) console.log(`  · ${file} (${statSync(join(result.dir, file)).size} bytes)`)
    console.log('  · SHA256SUMS (comprobar con: sha256sum -c SHA256SUMS)')
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
