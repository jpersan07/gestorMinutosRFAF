import { STATUS_LABELS } from '../app/matchStatus'
import type { MatchStatus } from '../domain'

const STYLES: Record<MatchStatus, string> = {
  scheduled: 'bg-panel-strong text-line',
  setup: 'bg-warn text-accent-ink',
  first_half: 'bg-accent text-accent-ink',
  halftime: 'bg-warn text-accent-ink',
  second_half: 'bg-accent text-accent-ink',
  finished: 'bg-line text-accent-ink',
  saved: 'bg-panel-strong text-muted',
}

export function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${STYLES[status]}`}>
      {status === 'saved' ? '✓ ' : ''}
      {STATUS_LABELS[status]}
    </span>
  )
}
