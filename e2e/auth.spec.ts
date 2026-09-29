import { expect, test, type Page } from '@playwright/test'
import { countEmailsTo, createCoach, recoveryLinkFor } from './admin.ts'
import { addPlayer, DEMO_PASSWORD, DEMO_USERS, fillLogin, login, prepareMatch } from './helpers.ts'

const AUTH_KEY = 'gestor-minutos-auth'

async function signOutFromList(page: Page) {
  await page.getByRole('button', { name: 'CERRAR SESIÓN' }).click()
  await page.getByRole('dialog', { name: '¿Cerrar sesión?' }).getByRole('button', { name: 'CERRAR SESIÓN' }).click()
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
}

async function addOnePlayer(page: Page, name: string) {
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await addPlayer(page, name, 7)
  await page.getByRole('link', { name: 'Volver' }).click()
}

async function playersOnDevice(page: Page) {
  await page.getByRole('link', { name: 'JUGADORES' }).click()
  await expect(page.getByRole('heading', { name: 'JUGADORES' })).toBeVisible()
  return page.getByRole('main')
}

/** Simula la sesión guardada con el token caducado (y opcionalmente revocada). */
async function expireStoredSession(page: Page, options: { revoke: boolean }) {
  await page.evaluate(
    ({ key, revoke }) => {
      const session = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
      session.expires_at = Math.floor(Date.now() / 1000) - 60
      if (revoke) session.refresh_token = 'revocado'
      localStorage.setItem(key, JSON.stringify(session))
    },
    { key: AUTH_KEY, revoke: options.revoke },
  )
}

test('contraseña incorrecta: mensaje claro, sin detalles técnicos', async ({ page }) => {
  await page.goto('/')
  await fillLogin(page, DEMO_USERS.isaac, 'no-es-la-clave')
  await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.')
})

test('entrar muestra el entrenador y el equipo; CERRAR SESIÓN conserva los datos del móvil (B-2)', async ({ page }) => {
  await login(page, 'isaac')
  await expect(page.getByText('ISAAC DEMO · Equipo DEMO')).toBeVisible()
  await addOnePlayer(page, 'Conservado')
  await signOutFromList(page)

  await login(page, 'isaac')
  await expect(await playersOnDevice(page)).toContainText('Conservado')
})

test('otra cuenta de OTRO equipo: aviso y una confirmación; cancelar no borra nada', async ({ page }) => {
  await login(page, 'isaac')
  await addOnePlayer(page, 'De Isaac')
  await signOutFromList(page)

  await fillLogin(page, DEMO_USERS.otro, DEMO_PASSWORD)
  const warning = page.getByRole('alertdialog', { name: 'Datos de otro equipo en este móvil' })
  await expect(warning).toContainText('1 jugador')
  await expect(warning).toContainText('Otro equipo DEMO')
  await warning.getByRole('button', { name: /CANCELAR/ }).click()
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()

  // Cancelar no borró nada.
  await fillLogin(page, DEMO_USERS.isaac, DEMO_PASSWORD)
  await expect(await playersOnDevice(page)).toContainText('De Isaac')
  await page.getByRole('link', { name: 'Volver' }).click()
  await signOutFromList(page)

  // Confirmar borra y entra en el otro equipo.
  await fillLogin(page, DEMO_USERS.otro, DEMO_PASSWORD)
  await page.getByRole('button', { name: 'BORRAR Y CONTINUAR' }).click()
  await expect(page.getByText('OTRO DEMO · Otro equipo DEMO')).toBeVisible()
  await expect(await playersOnDevice(page)).toContainText('Todavía no hay jugadores')
})

test('otra cuenta del MISMO equipo: los datos se conservan sin preguntar', async ({ page }) => {
  await login(page, 'isaac')
  await addOnePlayer(page, 'Compartido')
  await signOutFromList(page)
  await fillLogin(page, DEMO_USERS.jordi, DEMO_PASSWORD)
  await expect(page.getByText('JORDI DEMO · Equipo DEMO')).toBeVisible()
  await expect(await playersOnDevice(page)).toContainText('Compartido')
})

test('datos de prueba de la versión anterior: aviso con recuento y UNA confirmación (F3-3)', async ({ page }) => {
  await login(page, 'isaac')
  await addOnePlayer(page, 'De prueba')
  // Simula datos de la Fase 2: sin vincular a ninguna cuenta ni equipo.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('gestor-minutos')
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('meta', 'readwrite')
          for (const key of ['accountUserId', 'teamId', 'seasonId']) tx.objectStore('meta').delete(key)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await signOutFromList(page)
  await fillLogin(page, DEMO_USERS.isaac, DEMO_PASSWORD)
  const warning = page.getByRole('alertdialog', { name: 'Datos de prueba en este móvil' })
  await expect(warning).toContainText('datos de prueba de la versión anterior (1 jugador)')
  await warning.getByRole('button', { name: 'BORRAR Y CONTINUAR' }).click()
  await expect(await playersOnDevice(page)).toContainText('Todavía no hay jugadores')
})

test('SIN CONEXIÓN y con el token caducado: la app abre con la sesión guardada', async ({ page, context }) => {
  await login(page, 'isaac')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload() // controlada por el service worker (app disponible sin red)
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()

  await expireStoredSession(page, { revoke: false })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
  await expect(page.getByText('ISAAC DEMO · Equipo DEMO')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toHaveCount(0)
})

test('cuenta que no pertenece a ningún equipo: mensaje claro', async ({ page }) => {
  const coach = await createCoach({ inDemoTeam: false })
  await page.goto('/')
  await fillLogin(page, coach.email, coach.password)
  await expect(page.getByRole('alert')).toHaveText('Tu cuenta no pertenece a ningún equipo. Pide al administrador que te añada.')
  await page.getByRole('button', { name: 'CERRAR SESIÓN' }).click()
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
})

test('recuperar la contraseña por correo desde la app (B-4)', async ({ page, browser }) => {
  const coach = await createCoach({ inDemoTeam: true })
  await page.goto('/')
  await page.getByRole('link', { name: '¿Has olvidado la contraseña?' }).click()
  await expect(page.getByRole('heading', { name: 'RECUPERAR CONTRASEÑA' })).toBeVisible()
  await page.getByLabel('Email').fill(coach.email)
  await page.getByRole('button', { name: 'ENVIAR CORREO' }).click()
  await expect(page.getByRole('status')).toContainText('Si existe una cuenta con ese email')

  // El enlace se abre "en otro navegador" (como el correo en el móvil): contexto nuevo.
  const link = await recoveryLinkFor(coach.email)
  const other = await (await browser.newContext()).newPage()
  await other.goto(link)
  await other.getByLabel('Contraseña nueva').fill('nueva-clave-2026')
  await other.getByLabel('Repite la contraseña').fill('otra-distinta')
  await other.getByRole('button', { name: 'GUARDAR CONTRASEÑA' }).click()
  await expect(other.getByRole('alert')).toHaveText('Las dos contraseñas no coinciden.')
  await other.getByLabel('Repite la contraseña').fill('nueva-clave-2026')
  await other.getByRole('button', { name: 'GUARDAR CONTRASEÑA' }).click()
  await expect(other.getByRole('status')).toContainText('Contraseña cambiada')
  await other.getByRole('button', { name: 'ENTRAR EN LA APP' }).click()
  await expect(other.getByText(`${coach.displayName} · Equipo DEMO`)).toBeVisible()

  // El enlace solo vale una vez.
  const reused = await (await browser.newContext()).newPage()
  await reused.goto(link)
  await expect(reused.getByRole('alert')).toContainText('caducado o ya se ha usado')

  // La contraseña antigua ya no sirve; la nueva sí.
  await page.goto('/login')
  await fillLogin(page, coach.email, coach.password)
  await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.')
  await fillLogin(page, coach.email, 'nueva-clave-2026')
  await expect(page.getByRole('heading', { name: 'PARTIDOS' })).toBeVisible()
})

test('abrir el enlace de recuperación y abandonarlo NO deja la sesión iniciada', async ({ page, browser }) => {
  const coach = await createCoach({ inDemoTeam: true })
  await page.goto('/recuperar')
  await page.getByLabel('Email').fill(coach.email)
  await page.getByRole('button', { name: 'ENVIAR CORREO' }).click()
  const link = await recoveryLinkFor(coach.email)

  const other = await (await browser.newContext()).newPage()
  await other.goto(link)
  await expect(other.getByLabel('Contraseña nueva')).toBeVisible()
  // Se cierra la pestaña / se va a otra dirección sin cambiar la contraseña.
  await other.goto('/')
  await expect(other.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
})

test('recuperar con un email que no existe: mismo mensaje y ningún correo (no revela cuentas)', async ({ page }) => {
  const unknown = `nadie-${Date.now()}@test.local`
  await page.goto('/recuperar')
  await page.getByLabel('Email').fill(unknown)
  await page.getByRole('button', { name: 'ENVIAR CORREO' }).click()
  await expect(page.getByRole('status')).toContainText('Si existe una cuenta con ese email')
  expect(await countEmailsTo(unknown)).toBe(0)
})

test('B-5: sesión revocada DURANTE un partido → no expulsa; el partido sigue y se avisa', async ({ page }) => {
  await page.clock.install()
  await prepareMatch(page)
  await page.getByRole('button', { name: '▶ COMENZAR' }).click()
  const timer = page.getByRole('timer', { name: 'Cronómetro' })
  await expect(timer).toBeVisible()

  await expireStoredSession(page, { revoke: true })
  await page.clock.fastForward('01:00') // la renovación automática del token falla: sesión revocada

  const notice = page.getByRole('status').filter({ hasText: 'Tu sesión ha caducado' })
  await expect(notice).toContainText('El partido sigue guardándose en este móvil')
  await expect(notice).toContainText('Vuelve a iniciar sesión al terminar')
  await expect(timer).toBeVisible()
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toHaveCount(0)

  // Los controles siguen accesibles: se puede hacer un cambio con la sesión caducada.
  await page.getByRole('button', { name: 'DC: Jugador 10' }).click()
  await page.getByRole('dialog', { name: 'CAMBIO' }).getByRole('button', { name: /Jugador 12/ }).click()
  await page.getByRole('button', { name: 'CONFIRMAR' }).click()
  await expect(page.getByRole('button', { name: 'DC: Jugador 12' })).toBeVisible()

  // Fuera de la pantalla de juego se ofrece volver a entrar (sin expulsar ni tapar la navegación).
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(notice.getByRole('link', { name: 'INICIAR SESIÓN' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Volver' })).toBeVisible()
})

test('sesión revocada FUERA de un partido → pantalla de acceso con aviso', async ({ page }) => {
  await page.clock.install()
  await login(page, 'isaac')
  await expireStoredSession(page, { revoke: true })
  await page.clock.fastForward('01:00')
  await expect(page.getByRole('heading', { name: 'INICIAR SESIÓN' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Tu sesión ha caducado. Vuelve a iniciar sesión.')
})
