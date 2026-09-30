import { expect, test, type Page } from '@playwright/test'
import { createCoachWithOwnTeam } from './admin.ts'
import { addPlayers, createMatch, fillLogin, fillNextSlot, playerName as p } from './helpers.ts'

// CONVOCATORIA: minutos acumulados y "Sin convocar" de la temporada. Para jugar un partido
// completo en segundos se usa el MODO PRUEBAS (equipo DEMO).

const row = (page: Page, n: number) => page.getByRole('listitem').filter({ hasText: p(n) })

test('SIN CONVOCAR: cuenta la convocatoria guardada de los partidos finalizados; marcar sin guardar no cuenta', async ({
  page,
}) => {
  const coach = await createCoachWithOwnTeam({ teamName: 'DEMO' })
  await page.goto('/')
  await fillLogin(page, coach.email, coach.password)
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
  await addPlayers(page, 14)

  // Partido 1: convocados todos menos 13 y 14; se juega entero (modo pruebas).
  await createMatch(page, { opponent: 'Rival 1' })
  await page.getByRole('link', { name: /Rival 1/ }).click()
  await page.getByRole('button', { name: 'ACTIVAR MODO PRUEBAS' }).click()
  await page.getByRole('button', { name: 'CONVOCATORIA' }).click()
  await expect(row(page, 1)).toContainText('0 min · Sin convocar: 0')
  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  await page.getByRole('checkbox', { name: new RegExp(p(13)) }).uncheck()
  await page.getByRole('checkbox', { name: new RegExp(p(14)) }).uncheck()
  await page.getByRole('button', { name: 'GUARDAR' }).click()
  await expect(page.getByText('12 CONVOCADOS · GUARDADA')).toBeVisible()
  await page.getByRole('link', { name: 'Volver' }).click()
  await page.getByRole('button', { name: 'PREPARAR ALINEACIÓN' }).click()
  await page.getByRole('button', { name: '4-3-3' }).click()
  for (let n = 1; n <= 11; n++) await fillNextSlot(page, n)
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await page.getByRole('button', { name: 'IR A 90:00' }).click()
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()

  // Partido 2: la convocatoria muestra el histórico de la temporada.
  await page.goto('/')
  await createMatch(page, { opponent: 'Rival 2' })
  await page.getByRole('link', { name: /Rival 2/ }).click()
  await page.getByRole('button', { name: 'CONVOCATORIA' }).click()
  await expect(row(page, 1)).toContainText('90 min · Sin convocar: 0') // titular
  await expect(row(page, 12)).toContainText('0 min · Sin convocar: 0') // convocado sin jugar
  await expect(row(page, 13)).toContainText('0 min · Sin convocar: 1') // no convocado
  await expect(row(page, 14)).toContainText('0 min · Sin convocar: 1')

  // Marcar sin guardar no cambia nada; al recargar, lo mismo.
  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  await expect(row(page, 13)).toContainText('Sin convocar: 1')
  await page.reload()
  await expect(row(page, 13)).toContainText('0 min · Sin convocar: 1')

  // Orden: minutos y, a igualdad, dorsal como número (12, 13, 14 tras los titulares).
  const numbers = await page.getByRole('listitem').evaluateAll((items) =>
    items.map((item) => Number(item.querySelector('.tabular.w-8')?.textContent)),
  )
  expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
})
