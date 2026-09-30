import { useState } from 'react'
import type { SubstitutionCandidate } from '../../app/match/substitutionCandidates'
import type { PlayerRecord } from '../../data'
import { formatClock } from '../../domain'
import { BottomSheet } from '../../ui/BottomSheet'
import { ConfirmDialog } from '../../ui/ConfirmDialog'

export interface SubstitutionFlowProps {
  /** Jugador tocado en el campo (el que sale); null = cerrado. */
  readonly outgoing: { readonly player: PlayerRecord; readonly slotLabel: string } | null
  /**
   * Convocados fuera del campo (incluye los que ya salieron: reentrada permitida), por dorsal, con
   * sus minutos de este partido y de la temporada.
   */
  readonly candidates: readonly SubstitutionCandidate<PlayerRecord>[]
  readonly matchSecond: number
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: (incoming: PlayerRecord) => void
}

/** CAMBIO en 3 toques: jugador del campo → quién entra → CONFIRMAR. */
export function SubstitutionFlow({
  outgoing,
  candidates,
  matchSecond,
  busy,
  onCancel,
  onConfirm,
}: SubstitutionFlowProps) {
  const [incoming, setIncoming] = useState<PlayerRecord | null>(null)

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
        <p className="mb-2 flex justify-between text-sm font-bold tracking-wide text-muted">
          <span>SELECCIONA QUIÉN ENTRA</span>
          <span aria-hidden="true">PARTIDO · TEMPORADA</span>
        </p>
        {candidates.length === 0 ? (
          <p className="rounded-xl bg-pitch/60 p-4 text-muted">No quedan convocados fuera del campo.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {candidates.map(({ player, matchMinutes, seasonMinutes }) => (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => setIncoming(player)}
                  aria-label={`${player.number} ${player.name}: ${matchMinutes} minutos en este partido, ${seasonMinutes} en la temporada`}
                  className="flex min-h-16 w-full items-center gap-4 rounded-xl bg-panel-strong/60 px-4 text-left active:bg-panel-strong"
                >
                  <span className="tabular w-8 text-center text-xl font-black">{player.number}</span>
                  <span className="flex-1 truncate text-lg font-semibold">{player.name}</span>
                  <span className="tabular text-sm text-muted" title="Minutos en este partido · en la temporada">
                    <span className="font-bold text-line">{matchMinutes}'</span> · {seasonMinutes}'
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
