import { isAuthApiError, isAuthRetryableFetchError, isAuthWeakPasswordError } from '@supabase/supabase-js'

export type AuthAction = 'login' | 'reset-request' | 'reset-verify' | 'reset-update' | 'team'

const OFFLINE: Record<AuthAction, string> = {
  login: 'No hay conexión. Necesitas Internet para iniciar sesión.',
  'reset-request': 'No hay conexión. Necesitas Internet para pedir el correo.',
  'reset-verify': 'No hay conexión. Conéctate a Internet y vuelve a abrir el enlace.',
  'reset-update': 'No hay conexión. Conéctate a Internet para guardar la contraseña.',
  team: 'No hay conexión. Conéctate a Internet para terminar de entrar en tu equipo.',
}

const SERVER: Record<AuthAction, string> = {
  login: 'El servidor no responde ahora mismo. Inténtalo de nuevo en unos minutos.',
  'reset-request':
    'El servidor no ha podido enviar el correo ahora mismo. Inténtalo de nuevo en unos minutos o avisa al administrador.',
  'reset-verify': 'El servidor no ha podido comprobar el enlace ahora mismo. Inténtalo de nuevo en unos minutos.',
  'reset-update': 'El servidor no ha podido guardar la contraseña ahora mismo. Inténtalo de nuevo en unos minutos.',
  team: 'El servidor no responde ahora mismo. Inténtalo de nuevo en unos minutos.',
}

/** Estado HTTP del error; 0 = la petición no obtuvo respuesta (red, CSP/CORS, DNS…). */
function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * Sin conexión de verdad: la petición NO obtuvo respuesta. Si el servidor respondió (cualquier
 * estado HTTP > 0), hay conexión aunque la respuesta sea un error: supabase-js marca también los
 * 5xx como "reintentables" (AuthRetryableFetchError), pero eso es un fallo del servidor, no de la red.
 * `navigator.onLine` solo se tiene en cuenta cuando no hubo respuesta.
 */
export function isNetworkError(error: unknown): boolean {
  const status = httpStatus(error)
  if (status !== undefined && status > 0) return false
  return (
    isAuthRetryableFetchError(error) ||
    (error instanceof TypeError && /fetch|network/i.test(error.message)) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  )
}

/** El servidor respondió con un error propio (HTTP ≥ 500): hay conexión, pero no pudo completarlo. */
export function isServerError(error: unknown): boolean {
  const status = httpStatus(error)
  return status !== undefined && status >= 500
}

/**
 * Tras pedir el correo de recuperación: el mensaje de error a mostrar, o null para la respuesta
 * normal ("si existe una cuenta con ese email, te hemos enviado un correo"), exista o no el email.
 * Solo se informa de lo que el entrenador puede resolver o debe saber: sin conexión, demasiados
 * intentos o que el servidor no ha podido enviar el correo (p. ej. el SMTP falla).
 */
export function resetRequestError(error: unknown): string | null {
  if (!error) return null
  const code = (error as { code?: unknown }).code
  const rateLimited = code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit'
  if (isNetworkError(error) || isServerError(error) || rateLimited) return authErrorMessage(error, 'reset-request')
  return null
}

/** Mensaje claro para el entrenador; nunca el error técnico (PRD §33). */
export function authErrorMessage(error: unknown, action: AuthAction): string {
  if (isNetworkError(error)) return OFFLINE[action]
  if (isServerError(error)) return SERVER[action]
  if (isAuthWeakPasswordError(error)) return 'La contraseña es demasiado débil: usa al menos 8 caracteres.'
  if (isAuthApiError(error)) {
    switch (error.code) {
      case 'invalid_credentials':
        return 'Email o contraseña incorrectos.'
      case 'otp_expired':
        return 'El enlace ha caducado o ya se ha usado. Pide otro correo.'
      case 'same_password':
        return 'La contraseña nueva debe ser distinta de la anterior.'
      case 'weak_password':
        return 'La contraseña es demasiado débil: usa al menos 8 caracteres.'
      case 'user_banned':
        return 'Tu cuenta está desactivada. Habla con el administrador del equipo.'
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
        return 'Demasiados intentos. Espera unos minutos y vuelve a probar.'
      case 'email_not_confirmed':
        return 'Tu cuenta aún no está activada. Habla con el administrador del equipo.'
    }
  }
  return 'No se ha podido completar. Inténtalo de nuevo en unos segundos.'
}
