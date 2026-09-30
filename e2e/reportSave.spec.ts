import { expect, test } from '@playwright/test'
import { serverAdmin } from './admin.ts'
import { prepareMatch } from './helpers.ts'

// Bug de 30/09/2026: con el RESULTADO ya subido, escribir las observaciones y pulsar GUARDAR
// enseguida las perdía (MATCH_SAVED llegaba al servidor antes que el informe). Además, el reloj
// adelantado del test hace que la corrección con la hora del servidor vaya hacia atrás a mitad
// del informe: la edición posterior tampoco se puede perder por eso.

const serverReport = async (matchId: string) => {
  const { data } = await serverAdmin.from('match_reports').select('result, observations').eq('match_id', matchId).maybeSingle()
  return data
}
const serverStatus = async (matchId: string) =>
  (await serverAdmin.from('matches').select('status').eq('id', matchId).single()).data?.status

test('guardado rápido: resultado ya subido, observaciones y GUARDAR enseguida → nada se pierde', async ({ page }) => {
  const observations = 'Buen partido.\nLesión leve de Jugador 05.'
  await page.clock.install()
  await prepareMatch(page, 'CD Málaga')
  const matchId = /\/partidos\/([^/]+)/.exec(page.url())![1]!
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  await expect(page.getByRole('timer')).toBeVisible()
  await page.clock.fastForward('45:05')
  await page.getByRole('button', { name: 'CONFIGURAR 2ª PARTE' }).click()
  await page.getByRole('button', { name: 'CONFIRMAR ALINEACIÓN' }).click()
  await page.clock.fastForward('00:16')
  await page.getByRole('button', { name: '▶ CONTINUAR' }).click()
  await expect(page.getByText('SEGUNDA PARTE')).toBeVisible()
  await page.clock.fastForward('46:00')
  await expect(page.getByText('PARTIDO FINALIZADO')).toBeVisible()

  // El resultado llega solo al servidor (guardado automático + sincronización).
  await page.getByLabel('Resultado').fill('3-1')
  await expect.poll(() => serverReport(matchId), { timeout: 15_000 }).toMatchObject({ result: '3-1', observations: '' })

  // Observaciones y GUARDAR sin esperar a nada.
  await page.getByLabel('Incidencias relevantes / observaciones').fill(observations)
  await page.getByRole('button', { name: 'GUARDAR PARTIDO' }).click()
  await page.getByRole('button', { name: 'CONTINUAR' }).click()
  await page.getByRole('button', { name: 'GUARDAR DEFINITIVAMENTE' }).click()
  await expect(page.getByText('✓ PARTIDO GUARDADO')).toBeVisible()

  // El servidor queda GUARDADO con resultado + observaciones…
  await expect.poll(() => serverStatus(matchId), { timeout: 15_000 }).toBe('saved')
  await expect.poll(() => serverReport(matchId), { timeout: 15_000 }).toEqual({ result: '3-1', observations })

  // …y el móvil también, después de sincronizar y de recargar.
  await page.reload()
  await expect(page.getByText('✓ PARTIDO GUARDADO')).toBeVisible()
  await expect(page.getByLabel('Resultado')).toHaveValue('3-1')
  await expect(page.getByLabel('Incidencias relevantes / observaciones')).toHaveValue(observations)
})
