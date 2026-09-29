import { defineConfig, devices } from '@playwright/test'
import { execSync } from 'node:child_process'

/**
 * La app se compila contra el Supabase LOCAL (npm run db:start). La URL y la clave PUBLISHABLE
 * se leen en tiempo de ejecución de `supabase status`: no hay claves en el repositorio.
 */
export function localSupabaseEnv(): Record<string, string> {
  try {
    const raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, string | undefined>
    return {
      VITE_SUPABASE_URL: status.API_URL ?? '',
      VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY ?? '',
    }
  } catch {
    throw new Error('Supabase local no está en marcha: npm run db:start')
  }
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // Las pruebas "como en producción" (cabeceras de Vercel) tienen su propia configuración.
  testIgnore: 'prodlike/**',
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    env: localSupabaseEnv(),
  },
})
