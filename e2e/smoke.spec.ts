import { expect, test } from '@playwright/test'

test('la app arranca en ¿QUIÉN ERES? y declara el manifest PWA', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '¿QUIÉN ERES?' })).toBeVisible()
  for (const name of ['ISAAC', 'JORDI', 'JOSÉ']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBeTruthy()
})

test('abre sin conexión una vez instalado el service worker', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '¿QUIÉN ERES?' })).toBeVisible()
})
