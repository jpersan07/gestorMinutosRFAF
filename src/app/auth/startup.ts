import type { AppScope } from '../../data'
import type { Id } from '../../domain'

/**
 * Sesión guardada en el dispositivo:
 *   · none       → no hay sesión (nunca se entró, se cerró o fue revocada);
 *   · valid      → sesión comprobada (token vigente o renovado);
 *   · unverified → hay sesión guardada pero no se pudo renovar por falta de red.
 *     NO es "sin sesión": sin conexión y con el token caducado, supabase-js devuelve
 *     session = null + error de red, y la app debe seguir funcionando.
 */
export type StoredSession =
  | { readonly status: 'none' }
  | { readonly status: 'valid' | 'unverified'; readonly userId: Id }

export type StartupDecision =
  | { readonly kind: 'signed-out' }
  /** Hay sesión pero falta elegir/descargar el equipo (necesita conexión). */
  | { readonly kind: 'needs-team'; readonly userId: Id }
  | { readonly kind: 'ready'; readonly scope: AppScope; readonly sessionLost: boolean }

/**
 * Qué mostrar al abrir la app, solo con lo que hay en el dispositivo (sin esperar a la red).
 * `localScope`: equipo/temporada guardados para la última cuenta que entró en este móvil.
 * `liveMatch`: hay un partido en juego controlado por este dispositivo.
 */
export function resolveStartup(input: {
  readonly session: StoredSession
  readonly localScope: AppScope | null
  readonly liveMatch: boolean
}): StartupDecision {
  const { session, localScope, liveMatch } = input

  if (session.status === 'none') {
    // B-5: nunca se expulsa a un entrenador de un partido en curso por perder la sesión.
    if (localScope && liveMatch) return { kind: 'ready', scope: localScope, sessionLost: true }
    return { kind: 'signed-out' }
  }

  if (localScope && localScope.userId === session.userId) {
    return { kind: 'ready', scope: localScope, sessionLost: false }
  }
  return { kind: 'needs-team', userId: session.userId }
}
