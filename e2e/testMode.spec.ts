import { expect, test, type Page } from '@playwright/test'
import { createCoachWithOwnTeam, serverAdmin, serverEvents } from './admin.ts'
import { addPlayers, createMatch, fillLogin, fillNextSlot, playerName as p, substitute } from './helpers.ts'

// MODO PRUEBAS: solo para el equipo "DEMO". Adelanta el reloj con los comandos normales del
// dominio; el partido se sincroniza como cualquier otro.

const clock = (page: Page) => page.getByRole('timer', { name: 'Cronómetro', exact: true })
const matchIdFrom = (page: Page) => /\/partidos\/([^/]+)/.exec(page.url())?.[1] ?? ''

/** Entra con un entrenador de un equipo con ese nombre y deja un partido con alineación confirmada. */
async function preparedMatch(page: Page, teamName: string, options: { testMode: boolean }) {
  const coach = await createCoachWithOwnTeam({ teamName })
  await page.goto('/')
  await fillLogin(page, coach.email, coach.password)
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
  await addPlayers(page, 14)
  await createMatch(page, { opponent: 'CD Málaga' })
  await page.getByRole('link', { name: /CD Málaga/ }).click()
  if (options.testMode) await page.getByRole('button', { name: 'ACTIVAR MODO PRUEBAS' }).click()
  await page.getByRole('button', { name: 'PREPARAR ALINEACIÓN' }).click()
  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  await page.getByRole('button', { name: '4-3-3' }).click()
  for (let n = 1; n <= 11; n++) await fillNextSlot(page, n)
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await expect(page.getByText('✓ ALINEACIÓN CONFIRMADA')).toBeVisible()
  return coach
}

test('equipo normal: no hay modo pruebas, ni manipulando localStorage o la URL', async ({ page }) => {
  await preparedMatch(page, 'CD Real E2E', { testMode: false })
  await page.evaluate(() => {
    localStorage.setItem('isDemo', 'true')
    localStorage.setItem('testMode', 'true')
  })
  await page.goto(`${page.url()}?modo=pruebas&demo=1`)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(clock(page)).toBeVisible()
  await expect(page.getByText('🧪 MODO PRUEBAS')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+5:00' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByRole('button', { name: /MODO PRUEBAS/ })).toHaveCount(0)
})

test('DEMO: activar, adelantar, cambiar, recargar, descanso, 90:00, guardar y sincronizar', async ({ page }) => {
  await preparedMatch(page, 'DEMO', { testMode: true })
  const matchId = matchIdFrom(page)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(clock(page)).toBeVisible()
  await expect(page.getByText('🧪 MODO PRUEBAS').first()).toBeVisible()

  await page.getByRole('button', { name: '+5:00' }).click()
  await expect(clock(page)).toHaveText(/^05:\d\d$/)
  await substitute(page, 'DC', p(10), p(12))
  await page.getByRole('button', { name: '+10:00' }).click()
  await expect(clock(page)).toHaveText(/^15:\d\d$/)

  // Recarga: el partido y el reloj adelantado siguen ahí.
  await page.reload()
  await expect(clock(page)).toHaveText(/^15:\d\d$/)
  await expect(page.getByRole('button', { name: `DC: ${p(12)}` })).toBeVisible()
  await expect(page.getByRole('button', { name: '+1:00' })).toBeVisible()

  await page.getByRole('button', { name: 'IR A DESCANSO' }).click()
  await expect(page.getByRole('heading', { name: 'DESCANSO' })).toBeVisible()
  await page.getByRole('button', { name: 'IR A 90:00' }).click()
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()

  await page.getByLabel('Resultado').fill('2-0')
  await expect(page.getByText('Guardado en el dispositivo.')).toBeVisible()
  await page.getByRole('button', { name: 'GUARDAR PARTIDO' }).click()
  await page.getByRole('button', { name: 'CONTINUAR' }).click()
  await page.getByRole('button', { name: 'GUARDAR DEFINITIVAMENTE' }).click()
  await expect(page.getByText('✓ PARTIDO GUARDADO')).toBeVisible()

  // Todo llega al servidor con los eventos de siempre, ninguno con hora futura.
  await expect.poll(async () => (await serverEvents(matchId)).map((e) => e.event_type)).toContain('MATCH_SAVED')
  const types = (await serverEvents(matchId)).map((e) => e.event_type)
  expect(types).toEqual([
    'SETUP_STARTED',
    'LINEUP_CONFIRMED',
    'MATCH_STARTED',
    'HALF_STARTED',
    'PLAYER_OUT',
    'PLAYER_IN',
    'HALF_ENDED',
    'LINEUP_CONFIRMED',
    'HALF_STARTED',
    'HALF_ENDED',
    'MATCH_ENDED',
    'MATCH_SAVED',
  ])
  const { data } = await serverAdmin.from('match_events').select('occurred_at').eq('match_id', matchId)
  for (const row of data ?? []) expect(Date.parse(row.occurred_at as string)).toBeLessThanOrEqual(Date.now() + 5_000)
  const { data: match } = await serverAdmin.from('matches').select('status').eq('id', matchId).single()
  expect(match?.status).toBe('saved')
})
