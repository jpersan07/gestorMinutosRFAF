import { expect, test } from '@playwright/test'
import { addPlayer, login, createMatch } from './helpers.ts'

test('CONVOCATORIA: convocar a todos, quitar, guardar y enviar por WhatsApp', async ({ page, context }) => {
  await context.route('https://wa.me/**', (route) => route.fulfill({ body: 'whatsapp' }))
  await login(page)
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await addPlayer(page, 'Pedro', 9)
  await addPlayer(page, 'Álvaro', 4)
  await addPlayer(page, 'Juan', 10)
  await page.getByRole('link', { name: 'Volver' }).click()
  await createMatch(page, { opponent: 'Málaga CF', date: '2026-09-12', time: '18:00', location: 'Campo Municipal' })
  await page.getByRole('link', { name: /Málaga CF/ }).click()

  await page.getByRole('button', { name: 'CONVOCATORIA' }).click()
  await expect(page.getByText('0 CONVOCADOS')).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(3)

  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  await expect(page.getByText('3 CONVOCADOS')).toBeVisible()
  await page.getByRole('checkbox', { name: /Pedro/ }).uncheck()
  await expect(page.getByText('2 CONVOCADOS · SIN GUARDAR')).toBeVisible()

  // Salir sin guardar avisa.
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByRole('dialog', { name: 'Cambios sin guardar' })).toBeVisible()
  await page.getByRole('button', { name: 'SEGUIR' }).click()
  await expect(page.getByRole('heading', { name: 'CONVOCATORIA' })).toBeVisible()

  await page.getByRole('button', { name: 'GUARDAR' }).click()
  await expect(page.getByText('2 CONVOCADOS · GUARDADA')).toBeVisible()

  // Persiste y se ve en la ficha.
  await page.reload()
  await expect(page.getByRole('checkbox', { name: /Pedro/ })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Juan/ })).toBeChecked()
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByRole('button', { name: 'CONVOCATORIA · 2' })).toBeVisible()

  // WhatsApp: mensaje en orden alfabético con fecha, hora y ubicación.
  await page.getByRole('button', { name: 'CONVOCATORIA · 2' }).click()
  const popup = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'ENVIAR WHATSAPP' }).click()
  const url = new URL((await popup).url())
  expect(url.origin).toBe('https://wa.me')
  expect(url.searchParams.get('text')).toBe(
    ['VS MÁLAGA CF', 'Sábado 12/09 - 18:00 - Campo Municipal', '', 'CONVOCADOS:', '- Álvaro', '- Juan'].join('\n'),
  )
})
