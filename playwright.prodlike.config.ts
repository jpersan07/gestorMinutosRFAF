import { defineConfig, devices } from '@playwright/test'
import base, { localSupabaseEnv } from './playwright.config.ts'

/**
 * Pruebas "COMO EN PRODUCCIÓN": el mismo build, servido como lo sirve Vercel con vercel.json
 * (rutas de la SPA, caché y cabeceras de seguridad, CSP incluida), contra el Supabase LOCAL.
 * La única diferencia con producción: en la CSP, `https://*.supabase.co` → el Supabase local.
 *
 *   npm run test:e2e:prodlike
 *
 * 1. `critical`: los flujos críticos de siempre (acceso, recuperación de contraseña, partido
 *    completo, sin conexión, dos móviles y TOMAR CONTROL) con esas cabeceras.
 * 2. `deployment`: la comprobación de URL publicada (scripts/check-deployment.mjs) y que durante
 *    todo lo anterior el navegador NO bloqueó nada por la CSP.
 */
const env = localSupabaseEnv()
const port = 4174

export default defineConfig({
  ...base,
  testIgnore: undefined,
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    {
      name: 'critical',
      testMatch: ['smoke.spec.ts', 'auth.spec.ts', 'acceptance.spec.ts', 'sync.spec.ts', 'devices.spec.ts'],
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'deployment',
      testMatch: 'prodlike/*.spec.ts',
      dependencies: ['critical'],
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `npm run build && node scripts/serve-dist.mjs --port ${port} --supabase-origin ${env.VITE_SUPABASE_URL} --csp-reports`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    env,
  },
})
