import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router'
import { useApp } from '../../app/context'
import { listPlayers, type PlayerRecord } from '../../data'
import { Button } from '../../ui/Button'
import { Page } from '../../ui/Page'

function PlayerRow({ player }: { player: PlayerRecord }) {
  return (
    <li>
      <Link
        to={`/jugadores/${player.id}`}
        className={`flex min-h-16 items-center gap-4 rounded-xl bg-panel px-4 active:bg-panel-strong ${player.active ? '' : 'opacity-60'}`}
      >
        <span className="tabular flex size-11 shrink-0 items-center justify-center rounded-full bg-panel-strong text-lg font-black">
          {player.number}
        </span>
        <span className="flex-1 truncate text-lg font-semibold">{player.name}</span>
        <span className="text-sm font-bold text-muted">EDITAR</span>
      </Link>
    </li>
  )
}

export function PlayersPage() {
  const { db, scope } = useApp()
  const navigate = useNavigate()
  const players = useLiveQuery(() => listPlayers(db, scope.teamId), [db, scope.teamId])
  const active = players?.filter((p) => p.active) ?? []
  const inactive = players?.filter((p) => !p.active) ?? []

  return (
    <Page title="JUGADORES" back="/partidos">
      <Button onClick={() => navigate('/jugadores/nuevo')}>+ AÑADIR JUGADOR</Button>

      {players && active.length === 0 && (
        <p className="rounded-xl bg-panel p-4 text-muted">
          Todavía no hay jugadores. Añade la plantilla con <strong>AÑADIR JUGADOR</strong>.
        </p>
      )}

      {active.length > 0 && (
        <section aria-label="Plantilla" className="flex flex-col gap-2">
          <h2 className="text-sm font-bold tracking-wide text-muted">PLANTILLA · {active.length}</h2>
          <ul className="flex flex-col gap-2">
            {active.map((player) => (
              <PlayerRow key={player.id} player={player} />
            ))}
          </ul>
        </section>
      )}

      {inactive.length > 0 && (
        <section aria-label="Bajas" className="flex flex-col gap-2">
          <h2 className="text-sm font-bold tracking-wide text-muted">BAJAS · {inactive.length}</h2>
          <ul className="flex flex-col gap-2">
            {inactive.map((player) => (
              <PlayerRow key={player.id} player={player} />
            ))}
          </ul>
        </section>
      )}
    </Page>
  )
}
