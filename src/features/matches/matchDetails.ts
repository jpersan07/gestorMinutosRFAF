import { formatMatchDate } from '../../app/dates'
import type { MatchRecord } from '../../data'

/** "28 SEP 2026 · 18:00 · Campo Municipal" (omite lo que falte). */
export function matchDetailsLine(match: Pick<MatchRecord, 'matchDate' | 'kickoffTime' | 'location'>): string {
  return [formatMatchDate(match.matchDate), match.kickoffTime, match.location].filter(Boolean).join(' · ')
}
