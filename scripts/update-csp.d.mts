// Tipos de scripts/update-csp.mjs.
export function connectSources(production: { readonly supabaseUrl: string | null }, staging?: { readonly supabaseUrl: string | null }): string[]
export function withConnectSources(csp: string, sources: readonly string[]): string
export function expectedVercelConfig(config?: unknown, production?: unknown, staging?: unknown): unknown
