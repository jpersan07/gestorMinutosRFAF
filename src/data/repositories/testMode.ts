import {
  halfEndsAt,
  lineupOnField,
  replay,
  secondHalfAvailableAt,
  type EpochMs,
  type Id,
  type MatchEvent,
  type MatchState,
} from '../../domain'
import type { AppDatabase, MatchRecord } from '../db'
import type { DataEnv } from '../env'
import { failResult, okResult, type DataResult } from '../errors'
import { matchClockOffset } from '../sync/clock'
import { advanceMatch, listMatchEvents, runMatchCommand, type Actor } from './matchEngine'
import { isTestTeam } from './testTeam'

// MODO PRUEBAS (solo equipo DEMO): adelantar el reloj de un partido para probar el flujo completo
// sin esperar 90 minutos.
//
// No hay un segundo motor ni eventos especiales: el reloj del partido es el de siempre (hora del
// móvil corregida con la del servidor + la corrección congelada del partido, ver sync/clock.ts).
// En modo pruebas el partido se fecha hacia atrás al pulsar PLAY (TEST_CLOCK_BUDGET_MS) y los
// botones solo AUMENTAN esa corrección, sin superar nunca la hora real del servidor. Después, los
// finales de parte, el descanso, la 2ª parte y los cambios se registran con los mismos comandos y
// eventos del dominio: los minutos, la sincronización y la reconstrucción no cambian.

/** Nunca se adelanta hasta el mismo instante de la hora del servidor (margen para la red). */
const SAFETY_MS = 5_000

const started = (events: readonly MatchEvent[]) => events.some((e) => e.type === 'MATCH_STARTED')

/** ¿El partido pertenece al equipo DEMO? (el nombre viene del servidor, no del navegador). */
export async function testModeAvailable(db: AppDatabase, matchId: Id): Promise<boolean> {
  const match = await db.matches.get(matchId)
  return Boolean(match && isTestTeam(await db.teams.get(match.teamId)))
}

/** ¿Está el modo pruebas activo en este partido? (equipo DEMO + activado en este móvil). */
export async function testModeActive(db: AppDatabase, matchId: Id): Promise<boolean> {
  const match = await db.matches.get(matchId)
  return Boolean(match?.testMode && isTestTeam(await db.teams.get(match.teamId)))
}

/** Activar/desactivar el modo pruebas: solo equipo DEMO y solo antes de PLAY. */
export async function setTestMode(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  enabled: boolean,
): Promise<DataResult<void>> {
  return db.transaction('rw', [db.matches, db.teams, db.matchEvents], async () => {
    const match = await db.matches.get(matchId)
    if (!match) return failResult({ code: 'NOT_FOUND' })
    if (!isTestTeam(await db.teams.get(match.teamId))) return failResult({ code: 'TEST_MODE_UNAVAILABLE' })
    if (started(await listMatchEvents(db, matchId))) return failResult({ code: 'TEST_MODE_UNAVAILABLE' })
    await db.matches.update(matchId, { testMode: enabled ? { enabledAt: env.now() } : null })
    return okResult(undefined)
  })
}

/** Reloj del partido en modo pruebas y cuánto se puede adelantar todavía. */
export function testClock(
  match: Pick<MatchRecord, 'clockOffset'>,
  events: readonly MatchEvent[],
  env: DataEnv,
): { readonly matchNow: EpochMs; readonly remainingMs: number } {
  const liveOffset = env.clockOffsetMs?.() ?? 0
  const serverNow = env.now()
  const matchNow = serverNow - liveOffset + matchClockOffset(match, events, liveOffset).ms
  return { matchNow, remainingMs: Math.max(0, serverNow - SAFETY_MS - matchNow) }
}

/** Adelanta la corrección congelada del partido `ms` (validando equipo, modo, control y margen). */
async function shiftClock(db: AppDatabase, env: DataEnv, matchId: Id, actor: Actor, ms: number): Promise<DataResult<void>> {
  return db.transaction('rw', [db.matches, db.teams, db.matchEvents], async () => {
    const match = await db.matches.get(matchId)
    if (!match) return failResult({ code: 'NOT_FOUND' })
    if (match.controlLostAt) return failResult({ code: 'CONTROL_LOST' })
    const events = await listMatchEvents(db, matchId)
    if (!match.testMode || !isTestTeam(await db.teams.get(match.teamId)) || !started(events) || !match.clockOffset) {
      return failResult({ code: 'TEST_MODE_UNAVAILABLE' })
    }
    const state = replay(matchId, events)
    if (state.controllerDeviceId !== actor.deviceId) {
      return failResult({ code: 'NOT_CONTROLLER', controllerDeviceId: state.controllerDeviceId })
    }
    if (ms <= 0) return okResult(undefined)
    if (ms > testClock(match, events, env).remainingMs) return failResult({ code: 'TEST_CLOCK_EXHAUSTED' })
    await db.matches.update(matchId, { clockOffset: { ...match.clockOffset, ms: match.clockOffset.ms + ms } })
    return okResult(undefined)
  })
}

/**
 * +1:00 / +5:00 / +10:00: adelanta el reloj y registra lo que el reloj ya haya decidido (p. ej. el
 * final de la 1ª parte a la hora exacta si se cruza el 45:00), con el tick normal del dominio.
 */
export async function advanceTestClock(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  actor: Actor,
  ms: number,
): Promise<DataResult<MatchState>> {
  const shifted = await shiftClock(db, env, matchId, actor, ms)
  if (!shifted.ok) return shifted
  return advanceMatch(db, env, matchId, actor)
}

async function stateNow(db: AppDatabase, env: DataEnv, matchId: Id) {
  const match = (await db.matches.get(matchId))!
  const events = await listMatchEvents(db, matchId)
  return { match, state: replay(matchId, events), clock: testClock(match, events, env) }
}

/** IR A DESCANSO: lleva el reloj exactamente al final de la 1ª parte y el tick la cierra. */
export async function goToHalftime(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  actor: Actor,
): Promise<DataResult<MatchState>> {
  if (!(await testModeActive(db, matchId))) return failResult({ code: 'TEST_MODE_UNAVAILABLE' })
  const { state, clock } = await stateNow(db, env, matchId)
  if (state.status !== 'first_half') return failResult({ code: 'INVALID_TRANSITION', status: state.status, command: 'START_SECOND_HALF' })
  const end = halfEndsAt(state, 1)!
  return advanceTestClock(db, env, matchId, actor, Math.max(0, end - clock.matchNow))
}

/**
 * IR A 90:00: sin saltarse nada, con los comandos normales del dominio:
 *   1ª parte → final de la 1ª parte (descanso);
 *   descanso → confirma la alineación de la 2ª parte (la que está en el campo) si no lo está,
 *              espera el descanso mínimo y empieza la 2ª parte;
 *   2ª parte → final del partido a la hora exacta (tick).
 */
export async function goToFullTime(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  actor: Actor,
): Promise<DataResult<MatchState>> {
  if (!(await testModeActive(db, matchId))) return failResult({ code: 'TEST_MODE_UNAVAILABLE' })
  let { state } = await stateNow(db, env, matchId)

  if (state.status === 'first_half') {
    const result = await goToHalftime(db, env, matchId, actor)
    if (!result.ok) return result
    state = result.value
  }

  if (state.status === 'halftime') {
    if (!state.lineups[2]) {
      const lineup = lineupOnField(state)
      if (!lineup) return failResult({ code: 'LINEUP_NOT_CONFIRMED', half: 2 })
      const confirmed = await runMatchCommand(db, env, matchId, { type: 'CONFIRM_LINEUP', lineup }, actor)
      if (!confirmed.ok) return confirmed
    }
    const now = await stateNow(db, env, matchId)
    const available = secondHalfAvailableAt(now.state) ?? now.clock.matchNow
    const waited = await shiftClock(db, env, matchId, actor, Math.max(0, available - now.clock.matchNow))
    if (!waited.ok) return waited
    const second = await runMatchCommand(db, env, matchId, { type: 'START_SECOND_HALF' }, actor)
    if (!second.ok) return second
    state = second.value
  }

  if (state.status !== 'second_half') {
    return failResult({ code: 'INVALID_TRANSITION', status: state.status, command: 'START_SECOND_HALF' })
  }
  const { clock } = await stateNow(db, env, matchId)
  return advanceTestClock(db, env, matchId, actor, Math.max(0, halfEndsAt(state, 2)! - clock.matchNow))
}
