import { expect, test } from '@playwright/test'
import { addPlayer, chooseCoach } from './helpers.ts'

test('el entrenador queda recordado tras recargar', async ({ page }) => {
  await chooseCoach(page, 'JORDI')
  await expect(page.getByText('JORDI')).toBeVisible()
  await page.reload()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
  await expect(page.getByText('JORDI')).toBeVisible()
})

test('AÑADIR JUGADOR, validaciones, editar y dar de baja', async ({ page }) => {
  await chooseCoach(page)
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await expect(page.getByText('Todavía no hay jugadores')).toBeVisible()

  // Nombre y dorsal obligatorios.
  await page.getByRole('button', { name: '+ AÑADIR JUGADOR' }).click()
  await page.getByRole('button', { name: 'GUARDAR' }).click()
  await expect(page.getByText('Escribe el nombre.')).toBeVisible()
  await expect(page.getByText('Escribe el dorsal.')).toBeVisible()
  await page.getByRole('link', { name: 'Volver' }).click()

  await addPlayer(page, 'Jorge', 14)
  await addPlayer(page, 'Carlos', 7)
  await expect(page.getByRole('region', { name: 'Plantilla' }).getByRole('link')).toHaveText([/7\s*Carlos/, /14\s*Jorge/])

  // Dorsal repetido.
  await page.getByRole('button', { name: '+ AÑADIR JUGADOR' }).click()
  await page.getByLabel('Nombre').fill('Pablo')
  await page.getByLabel('Dorsal').fill('7')
  await page.getByRole('button', { name: 'GUARDAR' }).click()
  await expect(page.getByText('Ese dorsal ya lo tiene otro jugador de la plantilla.')).toBeVisible()
  await page.getByRole('link', { name: 'Volver' }).click()

  // Editar y dar de baja.
  await page.getByRole('link', { name: /Jorge/ }).click()
  await expect(page.getByRole('heading', { name: 'EDITAR JUGADOR' })).toBeVisible()
  await page.getByLabel('Nombre').fill('Jorge P.')
  await page.getByLabel('EN LA PLANTILLA').uncheck()
  await page.getByRole('button', { name: 'GUARDAR' }).click()
  await expect(page.getByRole('region', { name: 'Bajas' })).toContainText('Jorge P.')

  // Persiste tras recargar.
  await page.reload()
  await expect(page.getByRole('region', { name: 'Plantilla' })).toContainText('Carlos')
  await expect(page.getByRole('region', { name: 'Bajas' })).toContainText('Jorge P.')
})
