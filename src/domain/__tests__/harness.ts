import { expect } from 'vitest'
import {
  advance,
  computeMinutes,
  execute,
  FORMATIONS,
  initialMatchState,
  lineupOnField,
  secondHalfAvailableAt,
  type CommandContext,
  type DomainErrorCode,
  type ExecuteResult,
  type FormationId,
  type Id,
  type Lineup,
  type MatchCommand,
  type MatchEvent,
  type MatchState,
} from '..'

/** Sábado 28/09/2026 18:00 (hora de Madrid). */
export const T0 = Date.UTC(2026, 8, 28, 16, 0, 0)

/** p01 … p18. Convocados p01 … p16; p17 y p18 no. */
export const PLAYERS: Id[] = Array.from({ length: 18 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`)
export const SQUAD: Id[] = PLAYERS.slice(0, 16)

/** Rellena los slots de la formación en orden con los jugadores dados. */
export function lineupOf(formationId: FormationId, playerIds: readonly Id[]): Lineup {
  const slots: Record<string, Id> = {}
  FORMATIONS[formationId].slots.forEach((slot, i) => {
    const playerId = playerIds[i]
    if (playerId !== undefined) slots[slot.id] = playerId
  })
  return { formationId, slots }
}

/** Titulares p01 … p11 en 4-3-3 (GK p01, …, RW p11). */
export const LINEUP_433 = lineupOf('4-3-3', PLAYERS.slice(0, 11))

/** '57:42' → 3462 */
export function clock(value: string | number): number {
  if (typeof value === 'number') return value
  const [minutes, seconds] = value.split(':').map(Number)
  return (minutes ?? 0) * 60 + (seconds ?? 0)
}

/**
 * Simula un dispositivo gestionando un partido: guarda los eventos como lo haría
 * IndexedDB y controla un reloj falso (`now`).
 */
export class MatchHarness {
  events: MatchEvent[] = []
  state: MatchState
  now = T0
  deviceId = 'device-A'
  coachId = 'coach-isaac'
  squad: Id[] = [...SQUAD]
  private nextId = 0
  readonly matchId: Id
  private readonly idFactory: (() => Id) | null

  /** `idFactory`: por defecto ids legibles ('id-1'…); los tests de servidor pasan UUIDs reales. */
  constructor(matchId: Id = 'match-1', idFactory: (() => Id) | null = null) {
    this.matchId = matchId
    this.idFactory = idFactory
    this.state = initialMatchState(matchId)
  }

  ctx(overrides: Partial<CommandContext> = {}): CommandContext {
    return {
      now: this.now,
      deviceId: this.deviceId,
      coachId: this.coachId,
      squad: this.squad,
      newId: () => this.idFactory?.() ?? `id-${++this.nextId}`,
      ...overrides,
    }
  }

  run(command: MatchCommand, overrides: Partial<CommandContext> = {}): ExecuteResult {
    const result = execute(this.state, command, this.ctx(overrides))
    this.events.push(...result.events)
    this.state = result.state
    return result
  }

  must(command: MatchCommand, overrides: Partial<CommandContext> = {}): MatchEvent[] {
    const result = this.run(command, overrides)
    if (result.error) throw new Error(`${command.type} falló: ${JSON.stringify(result.error)}`)
    return result.events
  }

  expectError(command: MatchCommand, code: DomainErrorCode, overrides: Partial<CommandContext> = {}) {
    const result = this.run(command, overrides)
    expect(result.error?.code).toBe(code)
    return result
  }

  tick(): MatchEvent[] {
    const result = advance(this.state, this.ctx())
    this.events.push(...result.events)
    this.state = result.state
    return result.events
  }

  wait(seconds: number) {
    this.now += seconds * 1000
  }

  /** Pone el reloj real en el instante en que el cronómetro marca `time` ('57:42' o segundos). */
  at(time: string | number) {
    const second = clock(time)
    const duration = this.state.halfDurationS
    const half = second <= duration && this.state.status === 'first_half' ? 1 : 2
    const startedAt = this.state.halfStartedAt[half]
    if (startedAt === undefined) throw new Error(`La parte ${half} no ha empezado`)
    this.now = startedAt + (second - (half === 1 ? 0 : duration)) * 1000
  }

  // ---- Flujos habituales ----

  setup(lineup: Lineup = LINEUP_433) {
    this.must({ type: 'START_SETUP' })
    this.must({ type: 'CONFIRM_LINEUP', lineup })
  }

  kickOff(lineup: Lineup = LINEUP_433, overrides: Partial<CommandContext> = {}) {
    this.setup(lineup)
    this.must({ type: 'START_MATCH' }, overrides)
  }

  sub(outPlayerId: Id, inPlayerId: Id, time?: string | number) {
    if (time !== undefined) this.at(time)
    return this.must({ type: 'SUBSTITUTE', outPlayerId, inPlayerId })
  }

  toHalftime() {
    this.at(this.state.halfDurationS)
    this.tick()
  }

  /** Confirma la alineación de la 2ª parte (por defecto, la que acabó la 1ª) y arranca en cuanto se puede. */
  secondHalf(lineup?: Lineup) {
    const secondHalfLineup = lineup ?? lineupOnField(this.state)
    if (!secondHalfLineup) throw new Error('Sin alineación en el campo')
    this.must({ type: 'CONFIRM_LINEUP', lineup: secondHalfLineup })
    this.now = Math.max(this.now, secondHalfAvailableAt(this.state) ?? this.now)
    this.must({ type: 'START_SECOND_HALF' })
  }

  toFullTime() {
    this.at(2 * this.state.halfDurationS)
    this.tick()
  }

  /** Minutos mostrados por jugador. */
  minutes(): Record<Id, number> {
    return Object.fromEntries(computeMinutes(this.events).map((p) => [p.playerId, p.minutesPlayed]))
  }

  seconds(): Record<Id, number> {
    return Object.fromEntries(computeMinutes(this.events).map((p) => [p.playerId, p.secondsPlayed]))
  }
}

/** PRNG determinista (mulberry32) para los tests aleatorios reproducibles. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
