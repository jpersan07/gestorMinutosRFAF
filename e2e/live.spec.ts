import { expect, test } from '@playwright/test'
import { playerName as p, prepareMatch, substitute } from './helpers.ts'

test('partido: reloj, cambios, deshacer, recarga, descanso, 2ª parte con reentrada y final a los 90', async ({ page }) => {
  await page.clock.install()
  await prepareMatch(page)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()

  const timer = page.getByRole('timer', { name: 'Cronómetro' })
  await expect(page.getByText('PRIMERA PARTE')).toBeVisible()
  await expect(timer).toHaveText(/^00:0\d$/)

  await page.clock.fastForward('10:30')
  await expect(timer).toHaveText(/^10:3\d$/)

  // Cambio en 3 toques; el suplente muestra sus minutos del partido.
  await page.getByRole('button', { name: `DC: ${p(10)}` }).click()
  const sheet = page.getByRole('dialog', { name: 'CAMBIO' })
  await expect(sheet).toContainText(`Sale: 10 · ${p(10)} (DC)`)
  await expect(sheet.getByRole('button', { name: new RegExp(p(12)) })).toContainText("0'")
  await sheet.getByRole('button', { name: new RegExp(p(12)) }).click()
  await expect(page.getByRole('dialog', { name: '¿Confirmar cambio?' })).toContainText(`${p(10)} → ${p(12)}`)
  await page.getByRole('button', { name: 'CONFIRMAR' }).click()
  await expect(page.getByRole('button', { name: `DC: ${p(12)}` })).toBeVisible()
  await expect(page.getByText(`10' ${p(10)} → ${p(12)}`)).toBeVisible()

  // Deshacer el último cambio.
  await page.getByRole('button', { name: 'DESHACER' }).click()
  await page.getByRole('dialog', { name: '¿Deshacer el cambio?' }).getByRole('button', { name: 'DESHACER' }).click()
  await expect(page.getByRole('button', { name: `DC: ${p(10)}` })).toBeVisible()
  await expect(page.getByText('Toca un jugador para hacer un cambio.')).toBeVisible()

  await page.clock.fastForward('10:00')
  await substitute(page, 'DC', p(10), p(12))

  // Recarga en mitad del partido: mismo reloj y mismo campo; "/" reabre el partido.
  await page.reload()
  await expect(timer).toHaveText(/^20:3\d$/)
  await expect(page.getByRole('button', { name: `DC: ${p(12)}` })).toBeVisible()
  await page.goto('/')
  await expect(timer).toBeVisible()

  // 45:00: descanso automático, sin cambios.
  await page.clock.fastForward('25:00')
  await expect(page.getByRole('heading', { name: 'DESCANSO' })).toBeVisible()
  await expect(page.getByText('Primera parte finalizada.')).toBeVisible()
  await expect(page.getByRole('timer')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '▶ CONTINUAR' })).toBeDisabled()

  // 2ª parte: precargada con el final de la 1ª; vuelve a entrar Jugador 10 (reentrada).
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await expect(page.getByRole('button', { name: `DC: ${p(12)}` })).toBeVisible()
  await page.getByRole('button', { name: `ED: ${p(11)}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(p(10)) }).click()
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await expect(page.getByText('✓ ALINEACIÓN CONFIRMADA')).toBeVisible()
  await page.clock.fastForward('00:16')
  await expect(page.getByRole('button', { name: '▶ CONTINUAR' })).toBeEnabled()
  await page.getByRole('button', { name: '▶ CONTINUAR' }).click()

  await expect(page.getByText('SEGUNDA PARTE')).toBeVisible()
  await expect(timer).toHaveText(/^45:0\d$/)
  await expect(page.getByRole('button', { name: `ED: ${p(10)}` })).toBeVisible()

  await page.clock.fastForward('12:42')
  await substitute(page, 'MC', p(7), p(13))

  // 90:00: final automático → resumen con minutos calculados desde los eventos.
  await page.clock.fastForward('35:00')
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()
  const minutes = page.getByRole('region', { name: 'MINUTOS' })
  const row = (n: number) => minutes.getByRole('listitem').filter({ hasText: p(n) })
  await expect(row(1)).toContainText("90'")
  await expect(row(10)).toContainText("65'") // 0–20 y reentrada 45–90
  await expect(row(12)).toContainText("70'") // 20–90
  await expect(row(11)).toContainText("45'") // se queda en el descanso
  await expect(row(7)).toContainText("57'")
  await expect(row(13)).toContainText("33'")
  await expect(row(14)).toContainText("0'")

  const changes = page.getByRole('region', { name: 'CAMBIOS' })
  await expect(changes.getByRole('listitem')).toHaveText([
    `20' ${p(10)} → ${p(12)}`,
    `45' Descanso: salen ${p(11)} · entran ${p(10)}`,
    `57' ${p(7)} → ${p(13)}`,
  ])
})
