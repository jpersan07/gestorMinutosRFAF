import { expect, test, type Page } from '@playwright/test'
import { createCoachWithOwnTeam } from './admin.ts'
import { addPlayers, createMatch, fillLogin, fillNextSlot, playerName as p, substitute } from './helpers.ts'

// Ventana CAMBIO: "minutos de este partido · minutos de la temporada". Los partidos se juegan en
// segundos con el MODO PRUEBAS (equipo DEMO).

async function startTestMatch(page: Page, opponent: string) {
  await page.goto('/')
  await createMatch(page, { opponent })
  await page.getByRole('link', { name: new RegExp(opponent) }).click()
  await page.getByRole('button', { name: 'ACTIVAR MODO PRUEBAS' }).click()
  await page.getByRole('button', { name: 'PREPARAR ALINEACIÓN' }).click()
  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  await page.getByRole('button', { name: '4-3-3' }).click()
  for (let n = 1; n <= 11; n++) await fillNextSlot(page, n)
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(page.getByRole('timer', { name: 'Cronómetro', exact: true })).toBeVisible()
}

test('CAMBIO: minutos de este partido · de la temporada (sin contar dos veces el partido en juego)', async ({ page }) => {
  const coach = await createCoachWithOwnTeam({ teamName: 'DEMO' })
  await page.goto('/')
  await fillLogin(page, coach.email, coach.password)
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
  await addPlayers(page, 14)

  // Partido 1 (terminado): el 10 juega 10′ y el 12 juega 80′.
  await startTestMatch(page, 'Rival 1')
  await page.getByRole('button', { name: '+10:00' }).click()
  await substitute(page, 'DC', p(10), p(12))
  await page.getByRole('button', { name: 'IR A 90:00' }).click()
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()

  // Partido 2 en juego: el 10 juega 0–20 y sale.
  await startTestMatch(page, 'Rival 2')
  await page.getByRole('button', { name: '+10:00' }).click()
  await page.getByRole('button', { name: '+10:00' }).click()
  await substitute(page, 'DC', p(10), p(13))

  await page.getByRole('button', { name: `DC: ${p(13)}` }).click()
  const sheet = page.getByRole('dialog', { name: 'CAMBIO' })
  await expect(sheet.getByText('PARTIDO · TEMPORADA')).toBeVisible()
  const row = (n: number) => sheet.getByRole('button', { name: new RegExp(`^${n} ${p(n)}:`) })
  await expect(row(10)).toContainText("20' · 10'") // partido 20, temporada 10 (sin el partido en juego)
  await expect(row(12)).toContainText("0' · 80'")
  await expect(row(14)).toContainText("0' · 0'")

  // El reloj avanza: el 10 está fuera, sus minutos del partido no cambian; la temporada tampoco.
  await sheet.getByRole('button', { name: 'Cerrar' }).click()
  await page.getByRole('button', { name: '+5:00' }).click()
  await page.getByRole('button', { name: `DC: ${p(13)}` }).click()
  await expect(row(10)).toContainText("20' · 10'")
})
