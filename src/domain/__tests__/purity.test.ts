import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// El dominio debe poder ejecutarse en cualquier entorno (Vitest, navegador, servidor).
// tsconfig.domain.json ya impide los tipos del navegador; esto además vigila imports y relojes.

const DOMAIN_DIR = join(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const FORBIDDEN =
  /\b(window|document|localStorage|sessionStorage|indexedDB|navigator|fetch|setInterval|setTimeout|Date\.now|Math\.random|crypto)\b/

describe('independencia del dominio', () => {
  const files = sourceFiles(DOMAIN_DIR)

  it('hay ficheros de dominio que comprobar', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map((file) => [relative(DOMAIN_DIR, file), file]))(
    '%s solo importa código del propio dominio y no usa APIs del entorno',
    (_, file) => {
      const source = withoutComments(readFileSync(file, 'utf8'))
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])
      for (const specifier of imports) expect(specifier).toMatch(/^\.\.?\//)
      expect(source).not.toMatch(FORBIDDEN)
    },
  )
})
