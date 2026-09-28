import { expect, test, type Page } from '@playwright/test'
import { playerName as p, prepareMatch, substitute } from './helpers.ts'

const timer = (page: Page) => page.getByRole('timer', { name: 'Cronómetro' })

async function kickOff(page: Page) {
  await prepareMatch(page)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(timer(page)).toBeVisible()
}

test('cerrar la app en la 1ª parte y volver a abrirla: reabre el partido con el reloj correcto', async ({ context }) => {
  await context.clock.install({ time: new Date('2026-10-10T16:00:00Z') })
  const page = await context.newPage()
  await kickOff(page)
  await page.clock.fastForward('12:10')
  await substitute(page, 'DC', p(10), p(12))
  await page.close()

  // 8 minutos con la app cerrada.
  const again = await context.newPage()
  await again.clock.fastForward('08:00')
  await again.goto('/')
  await expect(timer(again)).toHaveText(/^20:1\d$/)
  await expect(again.getByRole('button', { name: `DC: ${p(12)}` })).toBeVisible()
  await expect(again.getByText(`12' ${p(10)} → ${p(12)}`)).toBeVisible()
})

test('teléfono bloqueado durante el final de la 1ª parte: al volver, descanso y 2ª parte disponible', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-10T16:00:00Z') })
  await kickOff(page)
  await page.clock.fastForward('40:00')
  await expect(timer(page)).toHaveText(/^40:0\d$/)

  // JavaScript suspendido 20 minutos (pantalla bloqueada).
  await page.clock.fastForward('20:00')
  await expect(page.getByRole('heading', { name: 'DESCANSO' })).toBeVisible()
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  // Los 15 s ya pasaron hace rato: se puede continuar sin esperar.
  await expect(page.getByText(/Preparando segunda parte/)).toHaveCount(0)
  await page.getByRole('button', { name: '▶ CONTINUAR' }).click()
  await expect(timer(page)).toHaveText(/^45:0\d$/)
})

test('recarga en el descanso mientras se prepara la 2ª parte: el borrador se conserva', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-10T16:00:00Z') })
  await kickOff(page)
  await page.clock.fastForward('45:00')
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await page.getByRole('button', { name: `ED: ${p(11)}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(p(13)) }).click()
  await expect(page.getByRole('button', { name: `ED: ${p(13)}` })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'DESCANSO' })).toBeVisible()
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await expect(page.getByRole('button', { name: `ED: ${p(13)}` })).toBeVisible()
})

test('app cerrada en la 2ª parte y reabierta después del 90: partido finalizado con los minutos exactos', async ({ context }) => {
  await context.clock.install({ time: new Date('2026-10-10T16:00:00Z') })
  const page = await context.newPage()
  await kickOff(page)
  await page.clock.fastForward('45:00')
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await page.clock.fastForward('00:16')
  await page.getByRole('button', { name: '▶ CONTINUAR' }).click()
  await expect(timer(page)).toHaveText(/^45:0\d$/)
  await page.clock.fastForward('20:10')
  await substitute(page, 'DC', p(10), p(12))
  await page.close()

  const again = await context.newPage()
  await again.clock.fastForward('01:00:00')
  await again.goto('/')
  await expect(again.getByText('PARTIDO FINALIZADO')).toBeVisible()
  const minutes = again.getByRole('region', { name: 'MINUTOS' })
  await expect(minutes.getByRole('listitem').filter({ hasText: p(10) })).toContainText("65'")
  await expect(minutes.getByRole('listitem').filter({ hasText: p(12) })).toContainText("25'")
  await expect(minutes.getByRole('listitem').filter({ hasText: p(1) })).toContainText("90'")
})

test('sin conexión: el partido sigue funcionando y guardando', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-10T16:00:00Z') })
  await kickOff(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await context.setOffline(true)
  await page.clock.fastForward('10:10')
  await substitute(page, 'DC', p(10), p(12))
  await page.reload()
  await expect(page.getByRole('button', { name: `DC: ${p(12)}` })).toBeVisible()
  await expect(timer(page)).toHaveText(/^10:1\d$/)
})
