import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useApp } from '../../app/context'
import { fieldErrors } from '../../app/messages'
import { useAction } from '../../app/useAction'
import { createPlayer, updatePlayer, type DataError, type PlayerRecord } from '../../data'
import { Button } from '../../ui/Button'
import { numberTakenMessage } from './conflicts'
import { Page } from '../../ui/Page'
import { TextField } from '../../ui/TextField'

function PlayerForm({ player }: { player: PlayerRecord | null }) {
  const { db, env, scope } = useApp()
  const navigate = useNavigate()
  const { run, busy, unexpected } = useAction()
  const [name, setName] = useState(player?.name ?? '')
  const [number, setNumber] = useState(player ? String(player.number) : '')
  const [active, setActive] = useState(player?.active ?? true)
  const [error, setError] = useState<DataError | null>(null)
  const errors = fieldErrors(error)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const shirt = number.trim() === '' ? null : Number(number)
    const result = await run(() =>
      player
        ? updatePlayer(db, env, player.id, { name, number: shirt, active })
        : createPlayer(db, env, scope.teamId, { name, number: shirt }),
    )
    if (!result) return
    if (result.ok) navigate('/jugadores', { replace: true })
    else setError(result.error)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {player?.syncState === 'conflict' && player.syncIssue === 'NUMBER_TAKEN' && (
        <p role="alert" className="rounded-xl bg-warn p-4 font-bold text-accent-ink">
          {numberTakenMessage(player)}
        </p>
      )}
      <TextField
        label="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
        autoCapitalize="words"
        error={errors.name}
      />
      <TextField
        label="Dorsal"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        error={errors.number}
      />
      {player && (
        <label className="flex min-h-16 items-center gap-4 rounded-xl bg-panel px-4">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="size-7 accent-accent"
          />
          <span className="flex flex-col">
            <span className="font-bold">EN LA PLANTILLA</span>
            <span className="text-sm text-muted">Desmárcalo para dar de baja al jugador. Su historial se conserva.</span>
          </span>
        </label>
      )}
      {unexpected && <p className="font-semibold text-danger">{unexpected}</p>}
      <Button type="submit" disabled={busy}>
        GUARDAR
      </Button>
    </form>
  )
}

export function PlayerFormPage() {
  const { playerId } = useParams()
  const { db } = useApp()
  const player = useLiveQuery(async () => (playerId ? ((await db.players.get(playerId)) ?? null) : null), [db, playerId])

  return (
    <Page title={playerId ? 'EDITAR JUGADOR' : 'AÑADIR JUGADOR'} back="/jugadores">
      {player === undefined ? null : playerId && !player ? (
        <p className="text-muted">No se ha encontrado el jugador.</p>
      ) : (
        <PlayerForm key={playerId ?? 'nuevo'} player={player} />
      )}
    </Page>
  )
}
