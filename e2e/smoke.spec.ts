import { expect, test } from '@playwright/test'

// Humo de la Fase 1: la app compila, arranca, es instalable y abre sin conexión.
// El flujo completo del PRD §37 se cubrirá en la Fase 2.

test('la app arranca y declara el manifest PWA', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'GESTOR DE MINUTOS' })).toBeVisible()
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifest).toBeTruthy()
})

test('abre sin conexión una vez instalado el service worker', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload() // la página pasa a estar controlada por el service worker
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'GESTOR DE MINUTOS' })).toBeVisible()
})
