import { expect, test, type Page } from '@playwright/test'
import { serverAdmin, serverEvents, serverMatches, serverPlayers, takeControlFromAnotherPhone } from './admin.ts'
import { addPlayer, createMatch, fillLogin, login, playerName as p, prepareMatch, substitute } from './helpers.ts'

const OFFLINE = 'SIN CONEXIÓN — Los datos se guardarán cuando vuelva Internet.'
const syncStatus = (page: Page) => page.getByRole('status', { name: 'Sincronización' })

/** La app queda controlada por el service worker: abre y recarga sin red. */
async function installOffline(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
}

const matchIdFrom = (page: Page) => /\/partidos\/([^/]+)/.exec(page.url())?.[1] ?? ''

test('sin conexión: los cambios quedan pendientes, sobreviven a recargar y llegan al servidor al volver la red', async ({
  page,
  context,
}) => {
  const coach = (await login(page))!
  await installOffline(page)
  await expect(syncStatus(page)).toHaveText('✓ Sincronizado')

  await context.setOffline(true)
  await expect(page.getByText(OFFLINE)).toBeVisible()
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await addPlayer(page, 'Sin red', 7)
  await page.getByRole('link', { name: 'Volver' }).click()
  await createMatch(page, { opponent: 'Rival sin red' })
  await expect(syncStatus(page)).toHaveText('2 cambios pendientes')

  // Recargar sin red: todo sigue en el móvil y sigue pendiente.
  await page.reload()
  await expect(page.getByRole('link', { name: /Rival sin red/ })).toBeVisible()
  await expect(syncStatus(page)).toHaveText('2 cambios pendientes')
  expect(await serverPlayers(coach.teamId)).toEqual([])

  // Vuelve la red: se sube solo.
  await context.setOffline(false)
  await expect(syncStatus(page)).toHaveText('✓ Sincronizado')
  await expect(page.getByText(OFFLINE)).toHaveCount(0)
  expect(await serverPlayers(coach.teamId)).toEqual([{ name: 'Sin red', number: 7 }])
  expect((await serverMatches(coach.teamId)).map((m) => m.opponent)).toEqual(['Rival sin red'])
})

test('una caída de red NO bloquea el partido; los eventos suben al volver', async ({ page, context }) => {
  await page.clock.install()
  await prepareMatch(page)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(page.getByRole('timer', { name: 'Cronómetro' })).toBeVisible()
  const matchId = matchIdFrom(page)
  // Los eventos se suben durante el partido (C-4).
  await expect.poll(async () => (await serverEvents(matchId)).map((e) => e.event_type)).toContain('HALF_STARTED')

  await context.setOffline(true)
  await page.clock.fastForward('10:10')
  await substitute(page, 'DC', p(10), p(12))
  await expect(page.getByText(OFFLINE)).toBeVisible() // aviso dentro de la pantalla, sin tapar controles
  await expect(page.getByText(`10' ${p(10)} → ${p(12)}`)).toBeVisible()
  expect((await serverEvents(matchId)).map((e) => e.event_type)).not.toContain('PLAYER_IN')

  await context.setOffline(false)
  await expect.poll(async () => (await serverEvents(matchId)).map((e) => e.event_type)).toContain('PLAYER_IN')
  await expect(page.getByRole('button', { name: `DC: ${p(12)}` })).toBeVisible()
})

test('PÉRDIDA DE CONTROL: A sin conexión registra un cambio → B toma el control → A reconecta', async ({
  page,
  context,
}) => {
  await page.clock.install()
  const coach = await prepareMatch(page)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(page.getByRole('timer', { name: 'Cronómetro' })).toBeVisible()
  const matchId = matchIdFrom(page)
  await expect.poll(async () => (await serverEvents(matchId)).map((e) => e.event_type)).toContain('HALF_STARTED')

  // A se queda SIN CONEXIÓN y registra un cambio (no puede saber nada de B).
  await context.setOffline(true)
  await page.clock.fastForward('10:10')
  await substitute(page, 'DC', p(10), p(12))

  // Mientras, B toma el control en el servidor.
  await takeControlFromAnotherPhone(coach.teamId, matchId)

  // A reconecta: al sincronizar, el servidor rechaza sus eventos.
  await context.setOffline(false)
  await expect(page.getByRole('heading', { name: 'OTRO DISPOSITIVO HA TOMADO EL CONTROL' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Cambios no aplicados' })).toHaveText(`10' ${p(10)} → ${p(12)}`)

  // A ya no puede registrar nada: ni cambios (no hay campo) ni finales automáticos.
  await expect(page.getByRole('timer', { name: 'Cronómetro', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^DC: / })).toHaveCount(0)
  await page.clock.fastForward('40:00')
  await page.waitForTimeout(500)
  const server = await serverEvents(matchId)
  expect(server.at(-1)).toMatchObject({ event_type: 'CONTROL_TAKEN', device_id: 'movil-B' })
  expect(server.map((e) => e.event_type)).not.toContain('PLAYER_OUT')
  expect(server.map((e) => e.event_type)).not.toContain('HALF_ENDED')

  // Persistente: tras recargar sigue en CONTROL PERDIDO; en la lista se indica.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'OTRO DISPOSITIVO HA TOMADO EL CONTROL' })).toBeVisible()
  await page.getByRole('button', { name: 'VOLVER A PARTIDOS' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'CD Málaga' })).toContainText('Controlado por otro dispositivo')
  // "/" ya no reabre ese partido como partido en juego de este móvil.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
})

test('CERRAR SESIÓN con cambios pendientes: se avisa, se puede cancelar y nunca se borran (C-3)', async ({
  page,
  context,
}) => {
  const coach = (await login(page))!
  await installOffline(page)
  await context.setOffline(true)
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await addPlayer(page, 'Pendiente', 5)
  await page.getByRole('link', { name: 'Volver' }).click()

  await page.getByRole('button', { name: 'CERRAR SESIÓN' }).click()
  const dialog = page.getByRole('dialog', { name: '¿Cerrar sesión?' })
  await expect(dialog).toContainText('Hay 1 cambio sin subir al servidor.')
  await expect(dialog).toContainText('Sin conexión: se conservan en este móvil')
  await expect(dialog.getByRole('button', { name: 'SINCRONIZAR AHORA' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'CANCELAR' }).click()
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()

  // Sin conexión se cierra la sesión igualmente, sin borrar nada.
  await page.getByRole('button', { name: 'CERRAR SESIÓN' }).click()
  await dialog.getByRole('button', { name: 'CERRAR SESIÓN' }).click()
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
  await context.setOffline(false)
  await fillLogin(page, coach.email, coach.password)
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
  await expect(syncStatus(page)).toHaveText('✓ Sincronizado')
  expect(await serverPlayers(coach.teamId)).toEqual([{ name: 'Pendiente', number: 5 }])
})

test('conflicto de dorsal: el servidor decide y se avisa en el jugador (C-1)', async ({ page }) => {
  const coach = (await login(page))!
  // Otro móvil ya subió un jugador activo con el dorsal 9.
  const inserted = await serverAdmin
    .from('players')
    .insert({ id: crypto.randomUUID(), team_id: coach.teamId, name: 'Nueve del otro móvil', number: 9 })
  expect(inserted.error).toBeNull()

  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await addPlayer(page, 'Nueve de este móvil', 9)
  await expect(page.getByRole('alert')).toHaveText(
    'No se pudo guardar el jugador Nueve de este móvil (9): el dorsal ya está utilizado por otro jugador en el servidor. Cambia el dorsal para volver a intentarlo.',
  )
  expect(await serverPlayers(coach.teamId)).toEqual([{ name: 'Nueve del otro móvil', number: 9 }])

  // Cambiar el dorsal lo resuelve.
  await page.getByRole('link', { name: /Nueve de este móvil/ }).click()
  await page.getByLabel('Dorsal').fill('19')
  await page.getByRole('button', { name: 'GUARDAR' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect
    .poll(async () => (await serverPlayers(coach.teamId)).map((x) => x.number).sort((a, b) => a - b))
    .toEqual([9, 19])
})
