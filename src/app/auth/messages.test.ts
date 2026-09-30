import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authErrorMessage, isNetworkError, isServerError, resetRequestError } from './messages'

const OFFLINE_RESET = 'No hay conexión. Necesitas Internet para pedir el correo.'
const SERVER_RESET =
  'El servidor no ha podido enviar el correo ahora mismo. Inténtalo de nuevo en unos minutos o avisa al administrador.'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('el servidor respondió con un error (5xx): NO es "sin conexión", es un fallo del servidor', () => {
    // supabase-js convierte 500–504 y 520–530 en AuthRetryableFetchError (con su estado HTTP).
    for (const status of [500, 502, 503, 504, 522]) {
      const error = new AuthRetryableFetchError('Error sending recovery email', status)
      expect(isNetworkError(error), String(status)).toBe(false)
      expect(isServerError(error), String(status)).toBe(true)
      expect(authErrorMessage(error, 'reset-request'), String(status)).toBe(SERVER_RESET)
    }
    expect(authErrorMessage(new AuthRetryableFetchError('x', 500), 'login')).toMatch(/servidor no responde/)
  })

  it('sin respuesta (estado 0 o fallo de fetch): sí es "sin conexión"', () => {
    expect(isNetworkError(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(true)
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(authErrorMessage(new AuthRetryableFetchError('Failed to fetch', 0), 'reset-request')).toBe(OFFLINE_RESET)
    expect(isServerError(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(false)
  })

  it('navigator.onLine=false solo cuenta si no hubo respuesta del servidor', () => {
    vi.stubGlobal('navigator', { onLine: false })
    // El servidor respondió (400): hay conexión aunque el navegador diga lo contrario.
    expect(isNetworkError(new AuthApiError('x', 400, 'invalid_credentials'))).toBe(false)
    expect(authErrorMessage(new AuthApiError('x', 400, 'invalid_credentials'), 'login')).toBe('Email o contraseña incorrectos.')
    expect(isNetworkError(new AuthRetryableFetchError('x', 503))).toBe(false)
    // Sin respuesta: sí.
    expect(isNetworkError(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(true)
    expect(isNetworkError(new Error('sin estado HTTP'))).toBe(true)
    vi.stubGlobal('navigator', { onLine: true })
    expect(isNetworkError(new Error('sin estado HTTP'))).toBe(false)
  })

  it('pedir el correo de recuperación: qué se muestra', () => {
    // Respuesta normal (misma exista o no la cuenta).
    expect(resetRequestError(null)).toBeNull()
    expect(resetRequestError(new AuthApiError('x', 400, 'validation_failed'))).toBeNull()
    // Sin conexión, demasiados intentos o fallo del servidor al enviar: se avisa.
    expect(resetRequestError(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(OFFLINE_RESET)
    expect(resetRequestError(new AuthApiError('x', 429, 'over_email_send_rate_limit'))).toMatch(/Demasiados intentos/)
    expect(resetRequestError(new AuthApiError('x', 429, 'over_request_rate_limit'))).toMatch(/Demasiados intentos/)
    expect(resetRequestError(new AuthRetryableFetchError('Error sending recovery email', 500))).toBe(SERVER_RESET)
  })
})
