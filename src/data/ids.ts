import type { Id } from '../domain'

/**
 * UUID v4. `crypto.randomUUID` solo existe en contextos seguros (HTTPS/localhost);
 * al probar en el móvil por la IP local (http://192.168…) no está, así que se usa
 * `getRandomValues`, que sí está disponible siempre.
 */
export function newId(): Id {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
