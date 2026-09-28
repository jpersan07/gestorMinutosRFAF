import { expect, type Page } from '@playwright/test'

export async function chooseCoach(page: Page, name = 'ISAAC') {
  await page.goto('/')
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
}

export async function addPlayer(page: Page, name: string, number: number) {
  await page.getByRole('button', { name: '+ AÑADIR JUGADOR' }).click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Dorsal').fill(String(number))
  await page.getByRole('button', { name: 'GUARDAR' }).click()
  await expect(page.getByRole('heading', { name: 'JUGADORES' })).toBeVisible()
}
