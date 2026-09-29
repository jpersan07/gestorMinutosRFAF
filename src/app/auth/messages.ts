import { isAuthApiError, isAuthRetryableFetchError, isAuthWeakPasswordError } from '@supabase/supabase-js'

export type AuthAction = 'login' | 'reset-request' | 'reset-verify' | 'reset-update' | 'team'

const OFFLINE: Record<AuthAction, string> = {
  login: 'No hay conexión. Necesitas Internet para iniciar sesión.',
  'reset-request': 'No hay conexión. Necesitas Internet para pedir el correo.',
  'reset-verify': 'No hay conexión. Conéctate a Internet y vuelve a abrir el enlace.',
  'reset-update': 'No hay conexión. Conéctate a Internet para guardar la contraseña.',
  team: 'No hay conexión. Conéctate a Internet para terminar de entrar en tu equipo.',
}

export function isNetworkError(error: unknown): boolean {
  return (
    isAuthRetryableFetchError(error) ||
    (error instanceof TypeError && /fetch|network/i.test(error.message)) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  )
}

/** Mensaje claro para el entrenador; nunca el error técnico (PRD §33). */
export function authErrorMessage(error: unknown, action: AuthAction): string {
  if (isNetworkError(error)) return OFFLINE[action]
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
