import { expect, test } from '@playwright/test'
import { login, createMatch } from './helpers.ts'

test('NUEVO PARTIDO: solo el rival es obligatorio; la lista se ordena por fecha', async ({ page }) => {
  await login(page)
  await expect(page.getByText('Todavía no hay partidos')).toBeVisible()

  await page.getByRole('button', { name: '+ NUEVO PARTIDO' }).click()
  await page.getByRole('button', { name: 'CREAR PARTIDO' }).click()
  await expect(page.getByText('Escribe el club o equipo rival.')).toBeVisible()
  await page.getByRole('link', { name: 'Volver' }).click()

  await createMatch(page, { opponent: 'Equipo sin fecha' })
  await createMatch(page, { opponent: 'CD Málaga', date: '2026-10-10', time: '18:00', location: 'Campo Municipal' })
  await createMatch(page, { opponent: 'Atlético XXX', date: '2026-10-03' })

  const cards = page.getByRole('listitem')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0)).toContainText('Atlético XXX')
  await expect(cards.nth(0)).toContainText('3 OCT 2026')
  await expect(cards.nth(1)).toContainText('CD Málaga')
  await expect(cards.nth(1)).toContainText('10 OCT 2026 · 18:00 · Campo Municipal')
  await expect(cards.nth(2)).toContainText('Sin fecha')
  await expect(cards.nth(0)).toContainText('Pendiente')

  // Ficha del partido.
  await cards.nth(1).getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'CD Málaga', exact: true })).toBeVisible()
  await expect(page.getByText('Pendiente')).toBeVisible()

  // Persiste tras recargar.
  await page.goto('/partidos')
  await page.reload()
  await expect(page.getByRole('listitem')).toHaveCount(3)
})

test('el escudo se puede elegir al crear el partido', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: '+ NUEVO PARTIDO' }).click()
  await page.getByLabel('Club / equipo rival').fill('Rival con escudo')
  await page.getByLabel('Imagen del escudo').setInputFiles('public/pwa-192x192.png')
  await expect(page.getByRole('img', { name: 'Escudo' })).toBeVisible()
  await page.getByRole('button', { name: 'CREAR PARTIDO' }).click()
  await expect(page.getByRole('img', { name: 'Escudo de Rival con escudo' })).toBeVisible()
})

test('EDITAR completa los datos, cambia y quita el escudo', async ({ page }) => {
  await login(page)
  await createMatch(page, { opponent: 'Rival provisional' })
  await page.getByRole('link', { name: /Rival provisional/ }).click()

  await page.getByRole('button', { name: 'EDITAR' }).click()
  await expect(page.getByLabel('Club / equipo rival')).toHaveValue('Rival provisional')
  await page.getByLabel('Club / equipo rival').fill('CD Málaga')
  await page.getByLabel('Fecha').fill('2026-10-10')
  await page.getByLabel('Hora').fill('18:00')
  await page.getByLabel('Ubicación').fill('Campo Municipal')
  await page.getByLabel('Imagen del escudo').setInputFiles('public/pwa-192x192.png')
  await page.getByRole('button', { name: 'GUARDAR CAMBIOS' }).click()

  await expect(page.getByRole('heading', { name: 'CD Málaga', exact: true })).toBeVisible()
  await expect(page.getByText('10 OCT 2026 · 18:00 · Campo Municipal')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Escudo de CD Málaga' })).toBeVisible()

  // Al volver a editar se ven los datos y el escudo actuales; se puede quitar.
  await page.getByRole('button', { name: 'EDITAR' }).click()
  await expect(page.getByLabel('Ubicación')).toHaveValue('Campo Municipal')
  await expect(page.getByRole('img', { name: 'Escudo' })).toBeVisible()
  await page.getByRole('button', { name: 'Quitar escudo' }).click()
  await page.getByLabel('Ubicación').fill('')
  await page.getByRole('button', { name: 'GUARDAR CAMBIOS' }).click()
  await expect(page.getByRole('img', { name: 'Escudo de CD Málaga' })).toHaveCount(0)
  await expect(page.getByText('10 OCT 2026 · 18:00', { exact: true })).toBeVisible()
})
