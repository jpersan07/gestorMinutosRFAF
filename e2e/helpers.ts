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

export const playerName = (n: number) => `Jugador ${String(n).padStart(2, '0')}`

/** Desde la lista de partidos: añade `count` jugadores ("Jugador 01"…) y vuelve a la lista. */
export async function addPlayers(page: Page, count: number) {
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  for (let n = 1; n <= count; n++) await addPlayer(page, playerName(n), n)
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
}

/** En el editor: toca la primera posición vacía y elige al jugador. */
export async function fillNextSlot(page: Page, n: number) {
  await page.getByRole('button', { name: /: vacía$/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(playerName(n)) }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Equipo de `players` jugadores, un partido, convocatoria completa y alineación 4-3-3 confirmada. */
export async function prepareMatch(page: Page, opponent = 'CD Málaga', players = 14) {
  await chooseCoach(page)
  await addPlayers(page, players)
  await createMatch(page, { opponent })
  await page.getByRole('link', { name: new RegExp(opponent) }).click()
  await page.getByRole('button', { name: 'PREPARAR ALINEACIÓN' }).click()
  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  await page.getByRole('button', { name: '4-3-3' }).click()
  for (let n = 1; n <= 11; n++) await fillNextSlot(page, n)
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await expect(page.getByText('✓ ALINEACIÓN CONFIRMADA')).toBeVisible()
}
