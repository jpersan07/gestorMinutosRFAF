import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, type Supabase } from '../../data'
import type { StoredSession } from './startup'

/** Tiempo máximo que el arranque espera a la red para validar la sesión. */
export const SESSION_CHECK_TIMEOUT_MS = 3000

function storedUserId(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    const raw = storage.getItem(AUTH_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }) : null
    return typeof parsed?.user?.id === 'string' ? parsed.user.id : null
  } catch {
    return null
  }
}

const TIMEOUT = Symbol('timeout')

/**
 * Lee la sesión guardada SIN quedar esperando a la red:
 *   · no hay sesión guardada → none;
 *   · sin conexión → unverified (se usa la sesión guardada; se renovará al volver la red);
 *   · con conexión → getSession(), pero como mucho SESSION_CHECK_TIMEOUT_MS: con el token
 *     caducado supabase-js reintenta la renovación durante mucho tiempo si la red falla,
 *     y el arranque no puede depender de eso.
 */
export async function readStoredSession(
  supabase: Pick<Supabase, 'auth'>,
  options: {
    readonly storage?: Pick<Storage, 'getItem'>
    readonly online?: boolean
    readonly timeoutMs?: number
  } = {},
): Promise<StoredSession> {
  const userId = storedUserId(options.storage ?? localStorage)
  if (!userId) return { status: 'none' }
  if (!(options.online ?? navigator.onLine)) return { status: 'unverified', userId }

  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    supabase.auth.getSession(),
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), options.timeoutMs ?? SESSION_CHECK_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timer)

  if (result === TIMEOUT) return { status: 'unverified', userId }
  if (result.data.session) return { status: 'valid', userId: result.data.session.user.id }
  if (result.error && isAuthRetryableFetchError(result.error)) return { status: 'unverified', userId }
  return { status: 'none' }
}

/**
 * Recuperación de contraseña a medias: la sesión del enlace solo vale para cambiar la contraseña.
 * Se marca al validar el enlace y se desmarca al guardar la nueva; si la app arranca con la marca
 * (se cerró la pestaña sin terminar), esa sesión se cierra.
 */
export const RECOVERY_PENDING_KEY = 'gestor-minutos-recovery-pending'

export function markRecoveryPending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(RECOVERY_PENDING_KEY, '1')
    else localStorage.removeItem(RECOVERY_PENDING_KEY)
  } catch {
    // Sin almacenamiento: no hay nada que limpiar después.
  }
}

export async function discardUnfinishedRecovery(supabase: Pick<Supabase, 'auth'>): Promise<void> {
  let pending = false
  try {
    pending = localStorage.getItem(RECOVERY_PENDING_KEY) !== null
  } catch {
    return
  }
  if (!pending) return
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  markRecoveryPending(false)
}
