import { expect, type Page } from '@playwright/test'

/** Cuentas DEMO del seed local (supabase/seed.sql). Solo existen en el Supabase local. */
export const DEMO_PASSWORD = 'demo-local-2026'
export const DEMO_USERS = {
  isaac: 'isaac.demo@demo.local',
  jordi: 'jordi.demo@demo.local',
  jose: 'jose.demo@demo.local',
  otro: 'otro.demo@demo.local',
} as const

export async function fillLogin(page: Page, email: string, password: string) {
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'ENTRAR' }).click()
}

/** Inicia sesión con una cuenta DEMO y espera a la lista de partidos. */
export async function login(page: Page, user: keyof typeof DEMO_USERS = 'isaac') {
  await page.goto('/')
  await fillLogin(page, DEMO_USERS[user], DEMO_PASSWORD)
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
  await login(page)
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

/** En la pantalla de partido: toca al jugador del campo, elige quién entra y confirma. */
export async function substitute(page: Page, slot: string, outName: string, inName: string) {
  await page.getByRole('button', { name: `${slot}: ${outName}` }).click()
  await page.getByRole('dialog', { name: 'CAMBIO' }).getByRole('button', { name: new RegExp(inName) }).click()
  await expect(page.getByRole('dialog', { name: '¿Confirmar cambio?' })).toBeVisible()
  await page.getByRole('button', { name: 'CONFIRMAR' }).click()
  await expect(page.getByRole('button', { name: `${slot}: ${inName}` })).toBeVisible()
}

/**
 * Espera a que el borrador de alineación que contiene a ese jugador esté ESCRITO en IndexedDB.
 * (Una recarga a los pocos milisegundos de un toque cancela la escritura en curso; lo que la app
 * garantiza es que lo ya guardado sobrevive a una recarga.)
 */
export async function waitForDraftWith(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (playerName) =>
          new Promise<boolean>((resolve) => {
            const request = indexedDB.open('gestor-minutos')
            request.onsuccess = () => {
              const db = request.result
              const tx = db.transaction(['players', 'lineupDrafts'], 'readonly')
              const players = tx.objectStore('players').getAll()
              const drafts = tx.objectStore('lineupDrafts').getAll()
              tx.oncomplete = () => {
                const id = (players.result as Array<{ id: string; name: string }>).find((p) => p.name === playerName)?.id
                const found = (drafts.result as Array<{ lineup: { slots: Record<string, string> } }>).some(
                  (d) => id !== undefined && Object.values(d.lineup.slots).includes(id),
                )
                db.close()
                resolve(found)
              }
            }
            request.onerror = () => resolve(false)
          }),
        name,
      ),
    )
    .toBe(true)
}
