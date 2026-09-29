import { expect, test } from '@playwright/test'
import { addPlayers, createMatch, fillNextSlot, login, playerName as p, substitute } from './helpers.ts'

// Criterios de aceptación del PRD §37, paso a paso (reloj simulado).
test('flujo completo del PRD §37', async ({ page }) => {
  await page.clock.install()
  const timer = page.getByRole('timer', { name: 'Cronómetro' })

  // 1. Abrir aplicación · 2. Entrar como el entrenador (cuenta individual, Fase 3; equipo propio del test)
  const coach = (await login(page))!
  await expect(page.getByText(`${coach.displayName} · ${coach.teamName}`)).toBeVisible()
  // (datos previos: plantilla y dos partidos)
  await addPlayers(page, 15)
  await createMatch(page, { opponent: 'CD Málaga', date: '2026-10-10', time: '18:00' })
  await createMatch(page, { opponent: 'Atlético XXX', date: '2026-10-17' })

  // 3. Seleccionar un partido
  await page.getByRole('link', { name: /CD Málaga/ }).click()
  await page.getByRole('button', { name: 'PREPARAR ALINEACIÓN' }).click()
  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  // 4. Elegir 4-3-3 · 5. Asignar todas las posiciones · 6. Confirmar
  await page.getByRole('button', { name: '4-3-3' }).click()
  for (let n = 1; n <= 11; n++) await fillNextSlot(page, n)
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()

  // 7. Iniciar cronómetro
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(timer).toHaveText(/^00:0\d$/)

  // 8. Registrar una sustitución
  await page.clock.fastForward('30:10')
  await substitute(page, 'DC', p(10), p(12))

  // 9. Llegar a 45:00 · 10. Cambios bloqueados
  await page.clock.fastForward('15:00')
  await expect(page.getByRole('heading', { name: 'DESCANSO' })).toBeVisible()
  await expect(page.getByRole('button', { name: /: Jugador/ })).toHaveCount(0)

  // 11. Esperar al menos 15 s · 12. Configurar 2ª alineación · 13. Confirmarla
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await page.getByRole('button', { name: `ED: ${p(11)}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(p(13)) }).click()
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await expect(page.getByText(/Preparando segunda parte/)).toBeVisible()
  await expect(page.getByRole('button', { name: '▶ CONTINUAR' })).toBeDisabled()
  await page.clock.fastForward('00:16')

  // 14. Continuar partido
  await page.getByRole('button', { name: '▶ CONTINUAR' }).click()
  await expect(timer).toHaveText(/^45:0\d$/)

  // 15. Varias sustituciones (incluida una reentrada)
  await page.clock.fastForward('12:40')
  await substitute(page, 'MC', p(7), p(14))
  await page.clock.fastForward('13:00')
  await substitute(page, 'DC', p(12), p(10))
  await page.clock.fastForward('10:00')
  await substitute(page, 'LI', p(2), p(15))

  // 16. Llegar a 90:00 · 17. Final automático
  await page.clock.fastForward('10:00')
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()

  // 18. Minutos calculados
  const minutes = page.getByRole('region', { name: 'MINUTOS' })
  const expected: Record<number, number> = { 1: 90, 2: 80, 7: 57, 10: 50, 11: 45, 12: 40, 13: 45, 14: 33, 15: 10 }
  for (const [n, value] of Object.entries(expected)) {
    await expect(minutes.getByRole('listitem').filter({ hasText: p(Number(n)) })).toContainText(`${value}'`)
  }

  // 19. Historial de cambios
  await expect(page.getByRole('region', { name: 'CAMBIOS' }).getByRole('listitem')).toHaveText([
    `30' ${p(10)} → ${p(12)}`,
    `45' Descanso: salen ${p(11)} · entran ${p(13)}`,
    `57' ${p(7)} → ${p(14)}`,
    `70' ${p(12)} → ${p(10)}`,
    `80' ${p(2)} → ${p(15)}`,
  ])

  // 20. Rellenar informe · 21. GUARDAR · 22. Confirmar dos veces · 23. Guardar definitivamente
  await page.getByLabel('Resultado').fill('2-1')
  await page.getByLabel('Incidencias relevantes / observaciones').fill('Partido de prueba de aceptación.')
  await page.getByRole('button', { name: 'GUARDAR PARTIDO' }).click()
  await page.getByRole('button', { name: 'CONTINUAR' }).click()
  await page.getByRole('button', { name: 'GUARDAR DEFINITIVAMENTE' }).click()
  await expect(page.getByText('✓ PARTIDO GUARDADO')).toBeVisible()

  // 24. Volver a la lista · 25. Ver el partido como guardado
  await page.getByRole('button', { name: 'VOLVER A PARTIDOS' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'CD Málaga' })).toContainText('Guardado')

  // 26. Minutos acumulados: la convocatoria del siguiente partido los muestra y ordena por ellos.
  await page.getByRole('link', { name: /Atlético XXX/ }).click()
  await page.getByRole('button', { name: 'CONVOCATORIA' }).click()
  const rows = page.getByRole('listitem')
  await expect(rows.nth(0)).toContainText(p(1))
  await expect(rows.nth(0)).toContainText("90'")
  await expect(rows.filter({ hasText: p(10) })).toContainText("50'") // 0–30 + 70–90
  await expect(rows.filter({ hasText: p(15) })).toContainText("10'")
  await expect(rows.last()).toContainText("0'")
})
