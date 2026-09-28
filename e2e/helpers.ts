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

export interface NewMatch {
  opponent: string
  date?: string
  time?: string
  location?: string
}

/** Crea un partido desde la lista y vuelve a la lista. */
export async function createMatch(page: Page, match: NewMatch) {
  await page.getByRole('button', { name: '+ NUEVO PARTIDO' }).click()
  await page.getByLabel('Club / equipo rival').fill(match.opponent)
  if (match.date) await page.getByLabel('Fecha').fill(match.date)
  if (match.time) await page.getByLabel('Hora').fill(match.time)
  if (match.location) await page.getByLabel('Ubicación').fill(match.location)
  await page.getByRole('button', { name: 'CREAR PARTIDO' }).click()
  await expect(page.getByRole('heading', { name: match.opponent, exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
}
