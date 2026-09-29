// Tipos de scripts/check-build-env.mjs (lo usa vite.config.ts).
export function isSecretKey(value: unknown): boolean
export function checkBuildEnv(
  env: Record<string, string | undefined>,
  production: { readonly supabaseUrl: string | null; readonly appUrl?: string | null },
  staging?: { readonly supabaseUrl: string | null },
): string[]
export function assertBuildEnv(env: Record<string, string | undefined>): void
