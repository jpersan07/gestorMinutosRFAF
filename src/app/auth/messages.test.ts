import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { authErrorMessage } from './messages'

describe('mensajes de acceso', () => {
  it('sin red: explica que hace falta conexión, según la acción', () => {
    const offline = new AuthRetryableFetchError('Failed to fetch', 0)
    expect(authErrorMessage(offline, 'login')).toBe('No hay conexión. Necesitas Internet para iniciar sesión.')
    expect(authErrorMessage(new TypeError('Failed to fetch'), 'team')).toMatch(/Conéctate a Internet/)
  })

  it('credenciales, enlace caducado y contraseña débil', () => {
    expect(authErrorMessage(new AuthApiError('x', 400, 'invalid_credentials'), 'login')).toBe('Email o contraseña incorrectos.')
    expect(authErrorMessage(new AuthApiError('x', 403, 'otp_expired'), 'reset-verify')).toMatch(/caducado o ya se ha usado/)
    expect(authErrorMessage(new AuthWeakPasswordError('x', 422, ['length']), 'reset-update')).toMatch(/al menos 8/)
    expect(authErrorMessage(new AuthApiError('x', 403, 'user_banned'), 'login')).toMatch(/desactivada/)
  })

  it('nunca muestra el error técnico', () => {
    const message = authErrorMessage(new Error('PGRST500 internal error at 0x1234'), 'login')
    expect(message).not.toMatch(/PGRST|0x|internal/)
  })
})
