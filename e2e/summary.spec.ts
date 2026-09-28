import { expect, test } from '@playwright/test'
import { playerName as p, prepareMatch, substitute } from './helpers.ts'

test('resumen, informe con RESULTADO obligatorio, doble confirmación y solo lectura', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-10T16:00:00Z') })
  await prepareMatch(page, 'CD Málaga')
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(page.getByRole('timer')).toBeVisible()
  await page.clock.fastForward('30:05')
  await substitute(page, 'LI', p(2), p(12))
  await page.clock.fastForward('15:00')
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await page.getByRole('button', { name: '5-3-2' }).click()
  await page.getByRole('button', { name: /: vacía$/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(p(14)) }).click()
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await page.clock.fastForward('00:16')
  await page.getByRole('button', { name: '▶ CONTINUAR' }).click()
  await expect(page.getByText('SEGUNDA PARTE')).toBeVisible()
  await page.clock.fastForward('46:00')

  // Resumen.
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()
  await expect(page.getByText('FORMACIÓN 1ª PARTE: 4-3-3')).toBeVisible()
  await expect(page.getByText('FORMACIÓN 2ª PARTE: 5-3-2')).toBeVisible()
  await expect(page.getByRole('region', { name: 'CAMBIOS' }).getByRole('listitem')).toHaveText([
    `30' ${p(2)} → ${p(12)}`,
    `45' Descanso: salen ${p(11)} · entran ${p(14)}`,
  ])

  // RESULTADO obligatorio.
  await page.getByRole('button', { name: 'GUARDAR PARTIDO' }).click()
  await expect(page.getByText('Escribe el RESULTADO antes de guardar.')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // El informe se guarda solo: sobrevive a una recarga.
  await page.getByLabel('Resultado').fill('3-1')
  await page.getByLabel('Incidencias relevantes / observaciones').fill('Buen partido.\nLesión leve de Jugador 05.')
  await expect(page.getByText('Guardado en el dispositivo.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Resultado')).toHaveValue('3-1')
  await expect(page.getByLabel('Incidencias relevantes / observaciones')).toHaveValue(/Lesión leve/)

  // Doble confirmación: cancelar en cada paso no guarda.
  await page.getByRole('button', { name: 'GUARDAR PARTIDO' }).click()
  await expect(page.getByRole('dialog', { name: '¿Guardar partido?' })).toBeVisible()
  await page.getByRole('button', { name: 'CANCELAR' }).click()
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()

  await page.getByRole('button', { name: 'GUARDAR PARTIDO' }).click()
  await page.getByRole('button', { name: 'CONTINUAR' }).click()
  await expect(page.getByRole('dialog', { name: '¿ESTÁS SEGURO?' })).toBeVisible()
  await page.getByRole('button', { name: 'VOLVER' }).click()
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()

  await page.getByRole('button', { name: 'GUARDAR PARTIDO' }).click()
  await page.getByRole('button', { name: 'CONTINUAR' }).click()
  await page.getByRole('button', { name: 'GUARDAR DEFINITIVAMENTE' }).click()

  // Guardado: solo lectura.
  await expect(page.getByText('✓ PARTIDO GUARDADO')).toBeVisible()
  await expect(page.getByRole('button', { name: 'GUARDAR PARTIDO' })).toHaveCount(0)
  await expect(page.getByLabel('Resultado')).toBeDisabled()
  await expect(page.getByLabel('Incidencias relevantes / observaciones')).toBeDisabled()

  await page.getByRole('button', { name: 'VOLVER A PARTIDOS' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'CD Málaga' })).toContainText('Guardado')

  // Consulta posterior: resumen de solo lectura; la pantalla de juego redirige al resumen.
  await page.getByRole('link', { name: /CD Málaga/ }).click()
  await expect(page.getByRole('button', { name: 'EDITAR' })).toHaveCount(0)
  await page.getByRole('button', { name: 'RESUMEN' }).click()
  await expect(page.getByText('✓ PARTIDO GUARDADO')).toBeVisible()
  await page.goto(page.url().replace('/resumen', '/juego'))
  await expect(page.getByText('✓ PARTIDO GUARDADO')).toBeVisible()
})
