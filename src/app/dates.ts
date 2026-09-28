const pad = (n: number) => String(n).padStart(2, '0')

/** Fecha local 'YYYY-MM-DD' (no UTC: a las 00:30 en Madrid ya es el día siguiente). */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

/** '2026-09-28' → '28 SEP 2026' (como en el PRD). */
export function formatMatchDate(isoDate: string | null): string {
  if (!isoDate) return 'Sin fecha'
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return `${day} ${MONTHS[month - 1]} ${year}`
}
