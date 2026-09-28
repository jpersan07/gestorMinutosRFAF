import { useState } from 'react'
import type { PlayerRecord } from '../../data'
import {
  assignPlayer,
  changeFormation,
  clearSlot,
  emptyLineup,
  FORMATION_IDS,
  getFormation,
  slotOfPlayer,
  type FormationId,
  type Lineup,
  type SlotId,
} from '../../domain'
import { BottomSheet } from '../../ui/BottomSheet'
import { Button } from '../../ui/Button'
import { Pitch } from '../../ui/Pitch'
import { PitchSlot } from '../../ui/PitchSlot'

export interface LineupEditorProps {
  /** null = todavía no se ha elegido formación. */
  readonly lineup: Lineup | null
  /** Convocados: los únicos que se pueden alinear. */
  readonly players: readonly PlayerRecord[]
  readonly onChange: (lineup: Lineup) => void
}

/** Editor tipo campo: elegir formación y tocar cada posición para asignar un jugador. */
export function LineupEditor({ lineup, players, onChange }: LineupEditorProps) {
  const [openSlot, setOpenSlot] = useState<SlotId | null>(null)
  const [conflict, setConflict] = useState<{ player: PlayerRecord; slotId: SlotId } | null>(null)
  const byId = new Map(players.map((p) => [p.id, p]))
  const formation = lineup ? getFormation(lineup.formationId) : null
  const slotLabel = (slotId: SlotId) => formation?.slots.find((s) => s.id === slotId)?.label ?? slotId
  // Primero los libres (lo más habitual es elegir a uno de ellos); después los ya colocados.
  const placed = (player: PlayerRecord) => (lineup && slotOfPlayer(lineup, player.id) !== undefined ? 1 : 0)
  const sorted = [...players].sort((a, b) => placed(a) - placed(b) || a.number - b.number)

  function chooseFormation(formationId: FormationId) {
    onChange(lineup ? changeFormation(lineup, formationId) : emptyLineup(formationId))
  }

  function closeSheet() {
    setOpenSlot(null)
    setConflict(null)
  }

  function pick(player: PlayerRecord, allowMove = false) {
    if (!lineup || !openSlot) return
    const result = assignPlayer(lineup, openSlot, player.id, { allowMove })
    if (result.ok) {
      onChange(result.value)
      closeSheet()
    } else if (result.error.code === 'PLAYER_DUPLICATED') {
      setConflict({ player, slotId: result.error.slotId })
    }
  }

  const occupant = lineup && openSlot ? byId.get(lineup.slots[openSlot] ?? '') : undefined

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Formación" className="grid grid-cols-3 gap-2">
        {FORMATION_IDS.map((id) => (
          <Button
            key={id}
            size="md"
            variant={lineup?.formationId === id ? 'primary' : 'secondary'}
            aria-pressed={lineup?.formationId === id}
            onClick={() => chooseFormation(id)}
          >
            {id}
          </Button>
        ))}
      </div>

      {!lineup || !formation ? (
        <p className="rounded-xl bg-panel p-6 text-center text-xl font-black">ELIGE FORMACIÓN</p>
      ) : (
        <Pitch className="max-h-[62dvh] w-auto">
          {formation.slots.map((slot) => {
            const player = byId.get(lineup.slots[slot.id] ?? '')
            return (
              <PitchSlot
                key={slot.id}
                x={slot.x}
                y={slot.y}
                role={slot.label}
                player={player}
                ariaLabel={`${slot.label}: ${player ? player.name : 'vacía'}`}
                onClick={() => setOpenSlot(slot.id)}
              />
            )
          })}
        </Pitch>
      )}

      <BottomSheet
        open={openSlot !== null}
        title={openSlot ? `POSICIÓN · ${slotLabel(openSlot)}` : ''}
        subtitle={occupant ? `Ahora: ${occupant.number} · ${occupant.name}` : 'Elige un jugador'}
        onClose={closeSheet}
        footer={
          occupant && lineup && openSlot ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                onChange(clearSlot(lineup, openSlot))
                closeSheet()
              }}
            >
              QUITAR DE LA POSICIÓN
            </Button>
          ) : undefined
        }
      >
        {conflict && (
          <div role="alert" className="mb-3 flex flex-col gap-3 rounded-xl bg-warn p-4 text-accent-ink">
            <p className="font-bold">
              {conflict.player.name} ya está en {slotLabel(conflict.slotId)}. Un jugador no puede ocupar dos posiciones.
            </p>
            <Button variant="secondary" size="md" onClick={() => pick(conflict.player, true)}>
              MOVER AQUÍ
            </Button>
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {sorted.map((player) => {
            const placedIn = lineup ? slotOfPlayer(lineup, player.id) : undefined
            return (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => pick(player)}
                  className={`flex min-h-14 w-full items-center gap-4 rounded-xl px-4 text-left active:bg-panel-strong ${placedIn ? 'bg-pitch/60' : 'bg-panel-strong/60'}`}
                >
                  <span className="tabular w-8 text-center text-lg font-black">{player.number}</span>
                  <span className="flex-1 truncate text-lg font-semibold">{player.name}</span>
                  {placedIn && (
                    <span className="text-xs font-bold text-muted">
                      {placedIn === openSlot ? 'AQUÍ' : `EN ${slotLabel(placedIn)}`}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </BottomSheet>
    </div>
  )
}
