import { expect, test } from '@playwright/test'
import { checkDeployment } from '../../scripts/check-deployment.mjs'
import { localSupabaseEnv } from '../../playwright.config.ts'

// Se ejecuta DESPUÉS de los flujos críticos (proyecto `critical`) con las cabeceras de Vercel.

test('comprobación de URL publicada: todo correcto (sin iniciar sesión ni escribir datos)', async ({ baseURL }) => {
  const result = await checkDeployment(baseURL!, { expectSupabase: localSupabaseEnv().VITE_SUPABASE_URL })
  expect(result.checks.filter((c) => !c.ok)).toEqual([])
})

test('la CSP no bloqueó nada durante los flujos críticos', async ({ request }) => {
  const reports = (await (await request.get('/__csp-reports')).json()) as string[]
  expect(reports).toEqual([])
})

test('la CSP se aplica de verdad: un script en línea inyectado no se ejecuta', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__inyectado = true'
    document.body.append(script)
  })
  expect(await page.evaluate(() => (window as { __inyectado?: boolean }).__inyectado)).toBeUndefined()
  await expect.poll(async () => ((await (await request.get('/__csp-reports')).json()) as string[]).length).toBeGreaterThan(0)
})
