import { DEFAULT_HALF_DURATION_S } from '../constants'
import type { EpochMs, FormationId, Half, Id, Lineup, MatchSecond, MatchStatus, SlotId } from '../types'

export interface SubstitutionRecord {
  readonly id: Id
  readonly half: Half
  readonly matchSecond: MatchSecond
  readonly slotId: SlotId
  readonly outPlayerId: Id
  readonly inPlayerId: Id
  readonly undone: boolean
}

/** Estado derivado de los eventos. Nunca se persiste como verdad: se reconstruye. */
export interface MatchState {
  readonly matchId: Id
  readonly status: MatchStatus
  /** Dispositivo que puede modificar el partido (null antes de la preparación). */
  readonly controllerDeviceId: string | null
  readonly halfDurationS: number
  /** Convocatoria congelada al iniciar el partido. */
  readonly squad: readonly Id[]
  /** Última alineación confirmada de cada parte. */
  readonly lineups: Readonly<Partial<Record<Half, Lineup>>>
  /** Quién ocupa cada posición ahora mismo (o al final de la última parte jugada). */
  readonly onField: Readonly<Record<SlotId, Id>>
  readonly currentFormationId: FormationId | null
  readonly halfStartedAt: Readonly<Partial<Record<Half, EpochMs>>>
  readonly halfEndedAt: Readonly<Partial<Record<Half, EpochMs>>>
  readonly substitutions: readonly SubstitutionRecord[]
  readonly lastSeq: number
}

export function initialMatchState(matchId: Id): MatchState {
  return {
    matchId,
    status: 'scheduled',
    controllerDeviceId: null,
    halfDurationS: DEFAULT_HALF_DURATION_S,
    squad: [],
    lineups: {},
    onField: {},
    currentFormationId: null,
    halfStartedAt: {},
    halfEndedAt: {},
    substitutions: [],
    lastSeq: 0,
  }
}

/** La parte en juego o, en el descanso, la que acaba de terminar. */
export function currentHalf(state: MatchState): Half | null {
  switch (state.status) {
    case 'first_half':
    case 'halftime':
      return 1
    case 'second_half':
      return 2
    default:
      return null
  }
}

/** La parte que se está jugando ahora mismo (null fuera del juego, incluido el descanso). */
export function playingHalf(state: MatchState): Half | null {
  if (state.status === 'first_half') return 1
  if (state.status === 'second_half') return 2
  return null
}

export function isInPlay(state: MatchState): boolean {
  return playingHalf(state) !== null
}

export function slotOfPlayerOnField(state: MatchState, playerId: Id): SlotId | undefined {
  return Object.keys(state.onField).find((slotId) => state.onField[slotId] === playerId)
}

/** Disposición actual en el campo; en el descanso sirve para precargar la alineación de la 2ª parte. */
export function lineupOnField(state: MatchState): Lineup | null {
  if (state.currentFormationId === null) return null
  return { formationId: state.currentFormationId, slots: { ...state.onField } }
}

/** Convocados que no están en el campo: candidatos a entrar (reentrada permitida). */
export function benchPlayers(state: MatchState): Id[] {
  const onField = new Set(Object.values(state.onField))
  return state.squad.filter((playerId) => !onField.has(playerId))
}

/** El cambio que "Deshacer" anularía: el último no anulado de la parte en juego. */
export function lastUndoableSubstitution(state: MatchState): SubstitutionRecord | undefined {
  const half = playingHalf(state)
  if (half === null) return undefined
  return state.substitutions.findLast((sub) => !sub.undone && sub.half === half)
}
