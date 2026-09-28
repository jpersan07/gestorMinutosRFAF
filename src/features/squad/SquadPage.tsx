import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useBlocker, useParams } from 'react-router'
import { useApp, useCoachId } from '../../app/context'
import { errorMessage } from '../../app/messages'
import { openWhatsApp } from '../../app/squad/share'
import { buildSquadMessage } from '../../app/squad/whatsapp'
import { useAction } from '../../app/useAction'
import {
  getSquad,
  listPlayers,
  saveSquad,
  seasonPlayerTotals,
  type MatchRecord,
  type PlayerRecord,
} from '../../data'
import { canEditSquad, sortPlayersByMinutes, type Id, type PlayerTotals } from '../../domain'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Page } from '../../ui/Page'

interface SquadData {
  readonly match: MatchRecord
  readonly players: readonly PlayerRecord[]
  readonly savedSquad: readonly Id[]
  readonly totals: ReadonlyMap<Id, PlayerTotals>
}

function sameSelection(a: ReadonlySet<Id>, b: readonly Id[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id))
}

function SquadEditor({ match, players, savedSquad, totals }: SquadData) {
  const { db, env } = useApp()
  const coachId = useCoachId()
  const { run, busy, unexpected } = useAction()
  const [selected, setSelected] = useState<Set<Id>>(() => new Set(savedSquad))
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const locked = !canEditSquad(match.status)
  // Selección: jugadores activos por minutos acumulados. Bloqueada: los convocados, aunque ya estén de baja.
  const listed = sortPlayersByMinutes(
    locked ? players.filter((p) => savedSquad.includes(p.id)) : players.filter((p) => p.active),
    totals,
  )
  const dirty = !locked && !sameSelection(selected, savedSquad)
  const blocker = useBlocker(dirty)
  const chosen = listed.filter((p) => selected.has(p.id))

  function toggle(playerId: Id) {
    setJustSaved(false)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }

  async function save(): Promise<boolean> {
    setError(null)
    const result = await run(() => saveSquad(db, env, match.id, chosen.map((p) => p.id), coachId))
    if (!result) return false
    if (!result.ok) {
      setError(errorMessage(result.error))
      return false
    }
    setJustSaved(true)
    return true
  }

  async function sendWhatsApp() {
    if (!(await save())) return
    openWhatsApp(
      buildSquadMessage({
        opponent: match.opponent,
        date: match.matchDate,
        kickoffTime: match.kickoffTime,
        location: match.location,
        players: chosen,
      }),
    )
  }

  return (
    <>
      {locked ? (
        <p className="rounded-xl bg-panel p-4 font-semibold">
          El partido ya ha empezado: la convocatoria no se puede cambiar.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              setJustSaved(false)
              setSelected(new Set(players.filter((p) => p.active).map((p) => p.id)))
            }}
          >
            CONVOCAR A TODOS
          </Button>
        </div>
      )}

      <p className="text-sm font-bold tracking-wide text-muted" aria-live="polite">
        {selected.size === 1 ? '1 CONVOCADO' : `${selected.size} CONVOCADOS`}
        {dirty && <span className="text-warn"> · SIN GUARDAR</span>}
        {justSaved && !dirty && <span className="text-accent"> · GUARDADA</span>}
      </p>

      {listed.length === 0 ? (
        <p className="rounded-xl bg-panel p-4 text-muted">No hay jugadores en la plantilla. Añádelos en JUGADORES.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {listed.map((player) => (
            <li key={player.id}>
              <label className="flex min-h-16 items-center gap-4 rounded-xl bg-panel px-4 has-[:checked]:bg-panel-strong">
                <input
                  type="checkbox"
                  className="size-7 shrink-0 accent-accent"
                  checked={selected.has(player.id)}
                  disabled={locked}
                  onChange={() => toggle(player.id)}
                />
                <span className="tabular w-8 text-center text-lg font-black">{player.number}</span>
                <span className="flex-1 truncate text-lg font-semibold">{player.name}</span>
                <span className="tabular text-sm font-bold text-muted" title="Minutos esta temporada">
                  {totals.get(player.id)?.totalMinutes ?? 0}'
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-3 bg-pitch/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          {(error ?? unexpected) && <p className="font-semibold text-danger">{error ?? unexpected}</p>}
          <Button variant="secondary" onClick={() => void save()} disabled={busy || !dirty}>
            GUARDAR
          </Button>
          <Button onClick={() => void sendWhatsApp()} disabled={busy || selected.size === 0}>
            ENVIAR WHATSAPP
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Cambios sin guardar"
        confirmLabel="SALIR"
        cancelLabel="SEGUIR"
        variant="danger"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      >
        <p>Has cambiado la convocatoria y no la has guardado. Si sales, se perderán los cambios.</p>
      </ConfirmDialog>
    </>
  )
}

export function SquadPage() {
  const { matchId = '' } = useParams()
  const { db, scope } = useApp()
  const data = useLiveQuery(async (): Promise<SquadData | null> => {
    const match = await db.matches.get(matchId)
    if (!match) return null
    const [players, savedSquad, totals] = await Promise.all([
      listPlayers(db, scope.teamId),
      getSquad(db, matchId),
      seasonPlayerTotals(db, match.seasonId),
    ])
    return { match, players, savedSquad: savedSquad ?? [], totals }
  }, [db, matchId, scope.teamId])

  return (
    <Page title="CONVOCATORIA" back={`/partidos/${matchId}`}>
      {data === undefined ? null : data === null ? (
        <p className="text-muted">No se ha encontrado el partido.</p>
      ) : (
        <SquadEditor key={data.match.id} {...data} />
      )}
    </Page>
  )
}
