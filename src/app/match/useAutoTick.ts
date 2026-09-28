import { useEffect, useRef } from 'react'
import { advanceMatch, logError } from '../../data'
import { halfEndsAt, playingHalf, type MatchState } from '../../domain'
import { useApp, useCoachId } from '../context'

/**
 * Registra los finales automáticos (45:00 y 90:00) en cuanto vencen. Solo en el
 * dispositivo que controla el partido. Los eventos llevan la hora teórica exacta
 * aunque se detecten tarde (móvil bloqueado).
 */
export function useAutoTick(state: MatchState, now: number, enabled: boolean): void {
  const { db, env, scope } = useApp()
  const coachId = useCoachId()
  const running = useRef(false)
  const half = playingHalf(state)
  const endsAt = half === null ? null : halfEndsAt(state, half)
  const due = enabled && endsAt !== null && now >= endsAt

  useEffect(() => {
    if (!due || running.current) return
    running.current = true
    advanceMatch(db, env, state.matchId, { deviceId: scope.deviceId, coachId })
      .catch((error: unknown) => logError(db, error, { at: 'autoTick', matchId: state.matchId }))
      .finally(() => {
        running.current = false
      })
  }, [due, db, env, state.matchId, scope.deviceId, coachId])
}
