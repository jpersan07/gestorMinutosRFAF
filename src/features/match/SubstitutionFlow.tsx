import { useState } from 'react'
import type { PlayerRecord } from '../../data'
import { formatClock, type Id } from '../../domain'
import { BottomSheet } from '../../ui/BottomSheet'
import { ConfirmDialog } from '../../ui/ConfirmDialog'

export interface SubstitutionFlowProps {
  /** Jugador tocado en el campo (el que sale); null = cerrado. */
  readonly outgoing: { readonly player: PlayerRecord; readonly slotLabel: string } | null
  /** Convocados fuera del campo (incluye los que ya salieron: reentrada permitida). */
  readonly bench: readonly PlayerRecord[]
  /** Minutos que lleva cada jugador en el partido (calculados desde los eventos). */
  readonly minutesById: ReadonlyMap<Id, number>
  readonly matchSecond: number
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: (incoming: PlayerRecord) => void
}

/** CAMBIO en 3 toques: jugador del campo → quién entra → CONFIRMAR. */
export function SubstitutionFlow({
  outgoing,
  bench,
  minutesById,
  matchSecond,
  busy,
  onCancel,
  onConfirm,
}: SubstitutionFlowProps) {
  const [incoming, setIncoming] = useState<PlayerRecord | null>(null)
  const sorted = [...bench].sort((a, b) => a.number - b.number)

  const close = () => {
    setIncoming(null)
    onCancel()
  }

  return (
    <>
      <BottomSheet
        open={outgoing !== null && incoming === null}
        title="CAMBIO"
        subtitle={
          outgoing && (
            <>
              Sale: <strong className="text-line">{outgoing.player.number} · {outgoing.player.name}</strong> ({outgoing.slotLabel})
            </>
          )
        }
        onClose={close}
      >
        <p className="mb-2 text-sm font-bold tracking-wide text-muted">SELECCIONA QUIÉN ENTRA</p>
        {sorted.length === 0 ? (
          <p className="rounded-xl bg-pitch/60 p-4 text-muted">No quedan convocados fuera del campo.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => setIncoming(player)}
                  className="flex min-h-16 w-full items-center gap-4 rounded-xl bg-panel-strong/60 px-4 text-left active:bg-panel-strong"
                >
                  <span className="tabular w-8 text-center text-xl font-black">{player.number}</span>
                  <span className="flex-1 truncate text-lg font-semibold">{player.name}</span>
                  <span className="tabular text-sm text-muted" title="Minutos jugados en este partido">
                    {minutesById.get(player.id) ?? 0}'
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>

      <ConfirmDialog
        open={outgoing !== null && incoming !== null}
        title="¿Confirmar cambio?"
        confirmLabel="CONFIRMAR"
        busy={busy}
        onCancel={() => setIncoming(null)}
        onConfirm={() => {
          if (!incoming) return
          onConfirm(incoming)
          setIncoming(null)
        }}
      >
        <p className="tabular text-3xl font-black">{formatClock(matchSecond)}</p>
        <p>
          <strong>{outgoing?.player.name}</strong> → <strong>{incoming?.name}</strong>
        </p>
      </ConfirmDialog>
    </>
  )
}
