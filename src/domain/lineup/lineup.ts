import { PLAYERS_ON_FIELD } from '../constants'
import { fail, ok, type Result } from '../errors'
import { getFormation, isFormationId } from '../formations'
import type { FormationId, Id, Lineup, SlotId, SlotRole } from '../types'

export function emptyLineup(formationId: FormationId): Lineup {
  return { formationId, slots: {} }
}

export function slotOfPlayer(lineup: Lineup, playerId: Id): SlotId | undefined {
  return Object.keys(lineup.slots).find((slotId) => lineup.slots[slotId] === playerId)
}

export function missingSlots(lineup: Lineup): SlotId[] {
  return getFormation(lineup.formationId)
    .slots.map((slot) => slot.id)
    .filter((slotId) => lineup.slots[slotId] === undefined)
}

function hasSlot(formationId: FormationId, slotId: SlotId): boolean {
  return getFormation(formationId).slots.some((slot) => slot.id === slotId)
}

/**
 * Coloca un jugador en una posición. Si la posición estaba ocupada, el anterior queda fuera.
 * Un jugador no puede ocupar dos posiciones: si ya está en otra, devuelve PLAYER_DUPLICATED,
 * salvo que se pida explícitamente moverlo (`allowMove`).
 */
export function assignPlayer(
  lineup: Lineup,
  slotId: SlotId,
  playerId: Id,
  options: { allowMove?: boolean } = {},
): Result<Lineup> {
  if (!hasSlot(lineup.formationId, slotId)) return fail({ code: 'UNKNOWN_SLOT', slotId })

  const currentSlot = slotOfPlayer(lineup, playerId)
  if (currentSlot === slotId) return ok(lineup)
  if (currentSlot !== undefined && !options.allowMove) {
    return fail({ code: 'PLAYER_DUPLICATED', playerId, slotId: currentSlot })
  }

  const slots: Record<SlotId, Id> = { ...lineup.slots }
  if (currentSlot !== undefined) delete slots[currentSlot]
  slots[slotId] = playerId
  return ok({ formationId: lineup.formationId, slots })
}

export function clearSlot(lineup: Lineup, slotId: SlotId): Lineup {
  const slots: Record<SlotId, Id> = { ...lineup.slots }
  delete slots[slotId]
  return { formationId: lineup.formationId, slots }
}

/**
 * Cambia la formación conservando a los jugadores por rol y en orden de slot
 * (defensas con defensas, medios con medios…). Lo que no cabe queda sin asignar.
 */
export function changeFormation(lineup: Lineup, formationId: FormationId): Lineup {
  if (lineup.formationId === formationId) return lineup

  const playersByRole = new Map<SlotRole, Id[]>()
  for (const slot of getFormation(lineup.formationId).slots) {
    const playerId = lineup.slots[slot.id]
    if (playerId === undefined) continue
    playersByRole.set(slot.role, [...(playersByRole.get(slot.role) ?? []), playerId])
  }

  const slots: Record<SlotId, Id> = {}
  for (const slot of getFormation(formationId).slots) {
    const playerId = playersByRole.get(slot.role)?.shift()
    if (playerId !== undefined) slots[slot.id] = playerId
  }
  return { formationId, slots }
}

/**
 * Valida una alineación para confirmarla: formación conocida, posiciones de esa formación,
 * sin jugadores repetidos, completa y todos los jugadores convocados.
 */
export function validateLineup(lineup: Lineup, squad: readonly Id[]): Result<Lineup> {
  if (!isFormationId(lineup.formationId)) {
    return fail({ code: 'UNKNOWN_FORMATION', formationId: lineup.formationId })
  }

  const seen = new Map<Id, SlotId>()
  for (const [slotId, playerId] of Object.entries(lineup.slots)) {
    if (!hasSlot(lineup.formationId, slotId)) return fail({ code: 'UNKNOWN_SLOT', slotId })
    const previousSlot = seen.get(playerId)
    if (previousSlot !== undefined) {
      return fail({ code: 'PLAYER_DUPLICATED', playerId, slotId: previousSlot })
    }
    seen.set(playerId, slotId)
  }

  const missing = missingSlots(lineup).length
  if (missing > 0 || seen.size !== PLAYERS_ON_FIELD) {
    return fail({ code: 'LINEUP_INCOMPLETE', missing: Math.max(missing, PLAYERS_ON_FIELD - seen.size) })
  }

  const squadSet = new Set(squad)
  for (const playerId of seen.keys()) {
    if (!squadSet.has(playerId)) return fail({ code: 'PLAYER_NOT_IN_SQUAD', playerId })
  }

  return ok({ formationId: lineup.formationId, slots: { ...lineup.slots } })
}
