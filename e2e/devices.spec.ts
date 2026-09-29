import { devices, expect, test, type Browser, type Page } from '@playwright/test'
import { addCoachToTeam, serverEvents, type TestCoach } from './admin.ts'
import { addPlayer, createMatch, fillLogin, login, playerName as p, prepareMatch, substitute } from './helpers.ts'

// DOS MÓVILES (dos navegadores independientes, cada uno con su IndexedDB y su sesión) contra el
// Supabase local: descarga, modo consulta, TOMAR CONTROL y pérdida de control (bloque 3d).

test.setTimeout(120_000)

const matchIdFrom = (page: Page) => /\/partidos\/([^/]+)/.exec(page.url())?.[1] ?? ''

/** Otro móvil: navegador nuevo con la cuenta de otro entrenador del mismo equipo. */
async function secondPhone(browser: Browser, teamId: string) {
  const coach: TestCoach = await addCoachToTeam(teamId)
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:4173' })
  const page = await context.newPage()
  await page.goto('/')
  await fillLogin(page, coach.email, coach.password)
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
  return { coach, context, page }
}

/** Fuerza una pasada completa ahora (desconexión y reconexión) y espera a que termine. */
async function syncedJustNow(phone: Awaited<ReturnType<typeof secondPhone>>) {
  await phone.context.setOffline(true)
  const done = phone.page.waitForResponse((r) => r.url().includes('/rest/v1/player_match_minutes'))
  await phone.context.setOffline(false)
  await done
}

async function startMatch(page: Page) {
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(page.getByRole('timer', { name: 'Cronómetro', exact: true })).toBeVisible()
  const matchId = matchIdFrom(page)
  await expect.poll(async () => (await serverEvents(matchId)).map((e) => e.event_type)).toContain('HALF_STARTED')
  return matchId
}

test('móvil nuevo: otro entrenador entra por primera vez y descarga jugadores y partidos del equipo', async ({ page, browser }) => {
  const coach = (await login(page))!
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await addPlayer(page, 'Portero Uno', 1)
  await addPlayer(page, 'Delantero Nueve', 9)
  await page.getByRole('link', { name: 'Volver' }).click()
  await createMatch(page, { opponent: 'Rival descargado', date: '2026-10-10', time: '18:00' })
  await expect(page.getByRole('status', { name: 'Sincronización' })).toHaveText('✓ Sincronizado')

  const b = await secondPhone(browser, coach.teamId)
  await expect(b.page.getByRole('link', { name: /Rival descargado/ })).toBeVisible()
  await b.page.getByRole('link', { name: 'JUGADORES' }).click()
  await expect(b.page.getByText('Portero Uno')).toBeVisible()
  await expect(b.page.getByText('Delantero Nueve')).toBeVisible()
  await b.context.close()
})

test('fuera del partido la lista se actualiza cada 15 s', async ({ page, browser }) => {
  const coach = (await login(page))!
  const b = await secondPhone(browser, coach.teamId)
  await syncedJustNow(b)
  await createMatch(page, { opponent: 'Rival a los 15 s' })
  await expect(page.getByRole('status', { name: 'Sincronización' })).toHaveText('✓ Sincronizado')
  // La siguiente pasada de B llega 15 s después de la anterior: a los 8 s todavía no está…
  await b.page.waitForTimeout(8_000)
  await expect(b.page.getByRole('link', { name: /Rival a los 15 s/ })).toHaveCount(0)
  // …y antes de los 15 s aparece.
  await expect(b.page.getByRole('link', { name: /Rival a los 15 s/ })).toBeVisible({ timeout: 10_000 })
  await b.context.close()
})

test('modo consulta: solo lectura, se actualiza cada 5 s y TOMAR CONTROL exige conexión', async ({ page, browser }) => {
  const coach = await prepareMatch(page)
  const matchId = await startMatch(page)

  const b = await secondPhone(browser, coach.teamId)
  await b.page.getByRole('link', { name: /CD Málaga/ }).click()
  await expect(b.page.getByText('Controlado por otro dispositivo')).toBeVisible()
  await b.page.getByRole('button', { name: 'VER PARTIDO' }).click()
  await expect(b.page.getByText(/^MODO CONSULTA/)).toBeVisible()
  await expect(b.page.getByRole('timer', { name: 'Cronómetro (solo consulta)' })).toBeVisible()
  await expect(b.page.getByRole('listitem', { name: `DC: ${p(10)}` })).toBeVisible()
  // Nada que pulse genere eventos: ni jugadores del campo ni DESHACER.
  await expect(b.page.getByRole('button', { name: /^DC: / })).toHaveCount(0)
  await expect(b.page.getByRole('button', { name: 'DESHACER' })).toHaveCount(0)

  // A hace un cambio: B lo ve en ≤ 5 s (sin tocar nada).
  await syncedJustNow(b)
  await substitute(page, 'DC', p(10), p(12))
  await expect.poll(async () => (await serverEvents(matchId)).map((e) => e.event_type)).toContain('PLAYER_IN')
  await expect(b.page.getByRole('list', { name: 'Cambios del partido' })).toContainText(`${p(10)} → ${p(12)}`, {
    timeout: 7_000,
  })
  await expect(b.page.getByRole('listitem', { name: `DC: ${p(12)}` })).toBeVisible()

  // Sin conexión, TOMAR CONTROL no está disponible.
  await b.context.setOffline(true)
  await expect(b.page.getByRole('button', { name: 'TOMAR CONTROL' })).toBeDisabled()
  await expect(b.page.getByText('Necesitas conexión para tomar el control.')).toBeVisible()
  await b.context.setOffline(false)
  await expect(b.page.getByRole('button', { name: 'TOMAR CONTROL' })).toBeEnabled()
  expect((await serverEvents(matchId)).map((e) => e.event_type)).not.toContain('CONTROL_TAKEN')
  await b.context.close()
})

test('A sin conexión → B toma el control → A reconecta: pérdida, cambios de B, ENTENDIDO y recuperar el control', async ({
  page,
  context,
  browser,
}) => {
  const coach = await prepareMatch(page)
  const matchId = await startMatch(page)
  const b = await secondPhone(browser, coach.teamId)
  await b.page.goto(`/partidos/${matchId}/juego`)
  await expect(b.page.getByText(/^MODO CONSULTA/)).toBeVisible()

  // A se queda sin conexión y registra un cambio.
  await context.setOffline(true)
  await substitute(page, 'DC', p(10), p(12))

  // B toma el control (con conexión, por el servidor) y registra otro cambio.
  await b.page.getByRole('button', { name: 'TOMAR CONTROL' }).click()
  await b.page.getByRole('dialog', { name: '¿Tomar el control?' }).getByRole('button', { name: 'TOMAR CONTROL' }).click()
  await expect(b.page.getByRole('timer', { name: 'Cronómetro', exact: true })).toBeVisible()
  await substitute(b.page, 'DC', p(10), p(13))
  await expect.poll(async () => (await serverEvents(matchId)).map((e) => e.event_type)).toContain('PLAYER_IN')

  // A reconecta: pierde el control, ve lo que no se aplicó y el partido tal como lo dejó B.
  await context.setOffline(false)
  await expect(page.getByRole('heading', { name: 'OTRO DISPOSITIVO HA TOMADO EL CONTROL' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Cambios no aplicados' })).toHaveText(`0' ${p(10)} → ${p(12)}`)
  await expect(page.getByRole('list', { name: 'Cambios del partido' })).toHaveText(`0' ${p(10)} → ${p(13)}`)
  await expect(page.getByRole('listitem', { name: `DC: ${p(13)}` })).toBeVisible()
  // A no puede escribir.
  await expect(page.getByRole('button', { name: /^DC: / })).toHaveCount(0)
  await expect(page.getByRole('timer', { name: 'Cronómetro', exact: true })).toHaveCount(0)
  const server = await serverEvents(matchId)
  expect(server.filter((e) => e.event_type === 'PLAYER_IN')).toHaveLength(1)

  // ENTENDIDO: el aviso desaparece y queda en modo consulta (sin recuperar el control).
  await page.getByRole('button', { name: 'ENTENDIDO' }).click()
  await expect(page.getByText(/^MODO CONSULTA/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'OTRO DISPOSITIVO HA TOMADO EL CONTROL' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^DC: / })).toHaveCount(0)

  // A recupera el control por el flujo del servidor y vuelve a trabajar sobre el estado oficial.
  await page.getByRole('button', { name: 'TOMAR CONTROL' }).click()
  await page.getByRole('dialog', { name: '¿Tomar el control?' }).getByRole('button', { name: 'TOMAR CONTROL' }).click()
  await expect(page.getByRole('button', { name: `DC: ${p(13)}` })).toBeVisible()
  await substitute(page, 'DC', p(13), p(14))

  // B lo ve en su siguiente sincronización: ahora es B quien ha perdido el control.
  await expect(b.page.getByRole('heading', { name: 'OTRO DISPOSITIVO HA TOMADO EL CONTROL' })).toBeVisible({ timeout: 20_000 })
  await expect(b.page.getByText('No había cambios pendientes en este móvil.')).toBeVisible()
  await expect(b.page.getByRole('list', { name: 'Cambios del partido' })).toContainText(`${p(13)} → ${p(14)}`, {
    timeout: 10_000,
  })
  await b.context.close()
})

test('conflicto de partido ya empezado: el cambio sin conexión de B no se aplica y B muestra los datos del servidor', async ({
  page,
  browser,
}) => {
  const coach = await prepareMatch(page)
  const matchId = matchIdFrom(page)
  const b = await secondPhone(browser, coach.teamId)
  await b.page.getByRole('link', { name: /CD Málaga/ }).click()

  // B, sin conexión, cambia el rival.
  await b.context.setOffline(true)
  await b.page.getByRole('button', { name: 'EDITAR' }).click()
  await b.page.getByLabel('Club / equipo rival').fill('Rival cambiado en B')
  await b.page.getByRole('button', { name: 'GUARDAR CAMBIOS' }).click()
  await expect(b.page.getByRole('heading', { name: 'Rival cambiado en B' })).toBeVisible()

  // Mientras, A empieza el partido.
  await startMatch(page)

  // B reconecta: el servidor rechaza el cambio (partido empezado) y B adopta los datos del servidor.
  await b.context.setOffline(false)
  await expect(b.page.getByRole('heading', { name: 'CD Málaga', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(b.page.getByRole('alert')).toContainText('otro dispositivo ya lo había empezado. Se muestran los datos del servidor.')
  await expect(b.page.getByRole('button', { name: 'VER PARTIDO' })).toBeVisible()
  expect(matchId).not.toBe('')
  await b.context.close()
})
