// Tipos de scripts/backup-db.mjs (para los tests en TypeScript).
export function insideRepository(dir: string, repo?: string): boolean
export function backup(options: { readonly source?: string; readonly out?: string }): { readonly dir: string; readonly files: string[] }
