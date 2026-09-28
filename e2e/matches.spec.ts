import { expect, test } from '@playwright/test'
import { chooseCoach, createMatch } from './helpers.ts'

test('NUEVO PARTIDO: solo el rival es obligatorio; la lista se ordena por fecha', async ({ page }) => {
  await chooseCoach(page)
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
  await chooseCoach(page)
  await page.getByRole('button', { name: '+ NUEVO PARTIDO' }).click()
  await page.getByLabel('Club / equipo rival').fill('Rival con escudo')
  await page.getByLabel('Imagen del escudo').setInputFiles('public/pwa-192x192.png')
  await expect(page.getByRole('img', { name: 'Escudo' })).toBeVisible()
  await page.getByRole('button', { name: 'CREAR PARTIDO' }).click()
  await expect(page.getByRole('img', { name: 'Escudo de Rival con escudo' })).toBeVisible()
})
