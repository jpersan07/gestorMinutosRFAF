import { describe, expect, it } from 'vitest'
import { resolveStartup, type StoredSession } from './startup'

const scope = { deviceId: 'device-1', userId: 'isaac', teamId: 'team-1', seasonId: 'season-1' }
const none: StoredSession = { status: 'none' }
const valid = (userId = 'isaac'): StoredSession => ({ status: 'valid', userId })
const offline = (userId = 'isaac'): StoredSession => ({ status: 'unverified', userId })

describe('arranque de la app (sin esperar a la red)', () => {
  it('sin sesión → INICIAR SESIÓN', () => {
    expect(resolveStartup({ session: none, localScope: null, liveMatch: false })).toEqual({ kind: 'signed-out' })
    expect(resolveStartup({ session: none, localScope: scope, liveMatch: false })).toEqual({ kind: 'signed-out' })
  })

  it('sesión válida con el equipo ya guardado → app directamente', () => {
    expect(resolveStartup({ session: valid(), localScope: scope, liveMatch: false })).toEqual({
      kind: 'ready',
      scope,
      sessionLost: false,
    })
  })

  it('SIN CONEXIÓN con el token caducado (sesión sin verificar) → app directamente, no INICIAR SESIÓN', () => {
    expect(resolveStartup({ session: offline(), localScope: scope, liveMatch: false })).toEqual({
      kind: 'ready',
      scope,
      sessionLost: false,
    })
  })

  it('sesión sin equipo guardado en el móvil → elegir/descargar equipo', () => {
    expect(resolveStartup({ session: valid(), localScope: null, liveMatch: false })).toEqual({
      kind: 'needs-team',
      userId: 'isaac',
    })
  })

  it('entra otra cuenta distinta a la de los datos locales → elegir equipo (y decidir si se borran)', () => {
    expect(resolveStartup({ session: valid('jordi'), localScope: scope, liveMatch: false })).toEqual({
      kind: 'needs-team',
      userId: 'jordi',
    })
  })

  it('B-5: sesión perdida con un partido en juego → el partido continúa, con aviso', () => {
    expect(resolveStartup({ session: none, localScope: scope, liveMatch: true })).toEqual({
      kind: 'ready',
      scope,
      sessionLost: true,
    })
  })

  it('B-5: pero sin datos locales no hay partido que continuar', () => {
    expect(resolveStartup({ session: none, localScope: null, liveMatch: true })).toEqual({ kind: 'signed-out' })
  })
})
