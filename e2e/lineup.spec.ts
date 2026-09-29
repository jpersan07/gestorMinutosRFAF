import { expect, test } from '@playwright/test'
import { addPlayers, createMatch, fillNextSlot, login, playerName, prepareMatch, waitForDraftWith } from './helpers.ts'

test('editor de alineación: convocatoria, formación, posiciones, duplicados y borrador', async ({ page }) => {
  await login(page)
  await addPlayers(page, 13)
  await createMatch(page, { opponent: 'CD Málaga' })
  await page.getByRole('link', { name: /CD Málaga/ }).click()
  await page.getByRole('button', { name: 'PREPARAR ALINEACIÓN' }).click()

  // Sin convocatoria: CONVOCAR A TODOS.
  await expect(page.getByText('No hay convocatoria para este partido.')).toBeVisible()
  await page.getByRole('button', { name: 'CONVOCAR A TODOS' }).click()
  await expect(page.getByText('ELIGE FORMACIÓN')).toBeVisible()
  await expect(page.getByRole('button', { name: '▶', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: '4-3-3' }).click()
  await expect(page.getByText('La alineación está incompleta. Faltan 11 posiciones.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' })).toBeDisabled()

  for (let n = 1; n <= 3; n++) await fillNextSlot(page, n)
  await expect(page.getByText('Faltan 8 posiciones.')).toBeVisible()

  // El borrador sobrevive a una recarga.
  await waitForDraftWith(page, playerName(3))
  await page.reload()
  await expect(page.getByRole('button', { name: `POR: ${playerName(1)}` })).toBeVisible()
  await expect(page.getByText('Faltan 8 posiciones.')).toBeVisible()

  for (let n = 4; n <= 11; n++) await fillNextSlot(page, n)
  await expect(page.getByText(/Faltan/)).toHaveCount(0)

  // Un jugador no puede ocupar dos posiciones: mensaje claro.
  await page.getByRole('button', { name: `ED: ${playerName(11)}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(playerName(1)) }).click()
  await expect(page.getByRole('alert')).toContainText(`${playerName(1)} ya está en POR`)
  await page.getByRole('button', { name: 'Cerrar' }).click()
  await expect(page.getByRole('button', { name: `POR: ${playerName(1)}` })).toBeVisible()

  // Cambiar a un suplente.
  await page.getByRole('button', { name: `ED: ${playerName(11)}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(playerName(12)) }).click()
  await expect(page.getByRole('button', { name: `ED: ${playerName(12)}` })).toBeVisible()

  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await expect(page.getByText('✓ ALINEACIÓN CONFIRMADA')).toBeVisible()
  await expect(page.getByRole('button', { name: '▶ COMENZAR' })).toBeEnabled()

  // Editar después de confirmar obliga a volver a confirmar.
  await page.getByRole('button', { name: '5-3-2' }).click()
  await expect(page.getByText('✓ ALINEACIÓN CONFIRMADA')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '▶', exact: true })).toBeDisabled()

  // La ficha muestra el partido "En preparación".
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByText('En preparación')).toBeVisible()
})

test('PLAY inicia el partido y bloquea datos y convocatoria', async ({ page }) => {
  await prepareMatch(page)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(page.getByRole('timer', { name: 'Cronómetro' })).toBeVisible()
  await expect(page.getByText('PRIMERA PARTE')).toBeVisible()

  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByText('En juego')).toBeVisible()
  await expect(page.getByRole('button', { name: 'EDITAR' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'CONTINUAR PARTIDO' })).toBeVisible()

  const hub = page.url()
  await page.goto(`${hub}/editar`)
  await expect(page.getByText('El partido ya ha empezado: rival, escudo, fecha, hora y ubicación están bloqueados.')).toBeVisible()
  await page.goto(`${hub}/convocatoria`)
  await expect(page.getByText('El partido ya ha empezado: la convocatoria no se puede cambiar.')).toBeVisible()
  await expect(page.getByRole('checkbox').first()).toBeDisabled()
  await expect(page.getByRole('button', { name: 'ENVIAR WHATSAPP' })).toHaveCount(0)
})
