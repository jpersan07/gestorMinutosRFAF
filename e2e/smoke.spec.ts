import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('sin sesión la app arranca en INICIAR SESIÓN y declara el manifest PWA', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBeTruthy()
})

test('el código publicado no contiene claves secretas ni de servicio', () => {
  const assets = readdirSync('dist/assets').filter((f) => f.endsWith('.js'))
  expect(assets.length).toBeGreaterThan(0)
  for (const file of assets) {
    const code = readFileSync(`dist/assets/${file}`, 'utf8')
    // Valor de una clave secreta (la librería menciona el prefijo "sb_secret_", pero sin valor).
    expect(code, file).not.toMatch(/sb_secret_[A-Za-z0-9_-]{16,}/)
    // Ningún JWT con rol de servicio (clave service_role antigua).
    for (const jwt of code.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as { role?: string }
      expect(payload.role, file).not.toBe('service_role')
    }
  }
  // La clave pública (publishable) sí debe estar: es la única que usa la app.
  expect(assets.some((f) => /sb_publishable_[A-Za-z0-9_-]{16,}/.test(readFileSync(`dist/assets/${f}`, 'utf8')))).toBe(true)
})

test('abre sin conexión una vez instalado el service worker', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
})
