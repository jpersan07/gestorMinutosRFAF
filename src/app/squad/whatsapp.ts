export interface SquadMessageInput {
  readonly opponent: string
  /** Fecha local del partido, 'YYYY-MM-DD'. Opcional. */
  readonly date?: string | null
  /** Hora local, 'HH:MM'. Opcional. */
  readonly kickoffTime?: string | null
  readonly location?: string | null
  readonly players: readonly { readonly name: string; readonly number: number }[]
}

const weekdayFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' })

/** '2026-09-14' → 'Lunes 14/09'. Se trabaja en UTC para que la zona horaria no mueva el día. */
export function formatMatchDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  const weekday = weekdayFormatter.format(new Date(Date.UTC(year, month - 1, day)))
  const capitalized = weekday.charAt(0).toLocaleUpperCase('es') + weekday.slice(1)
  return `${capitalized} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`
}

/**
 * Mensaje de convocatoria:
 *
 *   VS MÁLAGA CF
 *   Sábado 14/09 - 18:00 - Campo Municipal
 *
 *   CONVOCADOS:
 *   - Carlos
 *   - Juan
 *
 * Los jugadores van por DORSAL, de menor a mayor y comparado como número (2 antes que 10); nunca
 * por minutos: el grupo no debe ver un ranking ni señalar a quien menos juega.
 * Si falta fecha, hora o ubicación, se omiten (y la línea entera si no hay ninguna).
 */
export function buildSquadMessage(input: SquadMessageInput): string {
  const details = [input.date ? formatMatchDay(input.date) : null, input.kickoffTime?.trim(), input.location?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(' - ')

  const names = [...input.players]
    .sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }))
    .map((player) => player.name.trim())

  return [
    `VS ${input.opponent.trim().toLocaleUpperCase('es')}`,
    ...(details ? [details] : []),
    '',
    'CONVOCADOS:',
    ...names.map((name) => `- ${name}`),
  ].join('\n')
}

/** Abre WhatsApp con el texto preparado; el entrenador elige el grupo. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
