import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback } from 'react'
import {
  getSquad,
  isTestTeam,
  listMatchEvents,
  listPlayers,
  runMatchCommand,
  type MatchRecord,
  type PlayerRecord,
} from '../../data'
import { replay, type Id, type MatchCommand, type MatchEvent, type MatchState } from '../../domain'
import { useApp, useCoachId } from '../context'

export interface MatchView {
  readonly match: MatchRecord
  readonly events: readonly MatchEvent[]
  /** Estado derivado de los eventos (nunca guardado como verdad). */
  readonly state: MatchState
  /** Convocados (antes de PLAY: la convocatoria guardada; después: la congelada en el partido). */
  readonly squad: readonly PlayerRecord[]
  readonly playersById: ReadonlyMap<Id, PlayerRecord>
  /** Este dispositivo puede modificar el partido. */
  readonly isController: boolean
  /** MODO PRUEBAS activo: equipo DEMO (según el servidor) y activado en este móvil. */
  readonly testMode: boolean
}

/** Partido reconstruido desde IndexedDB; se actualiza solo cuando cambian los datos. */
export function useMatch(matchId: Id): MatchView | null | undefined {
  const { db, scope } = useApp()
  return useLiveQuery(async (): Promise<MatchView | null> => {
    const match = await db.matches.get(matchId)
    if (!match) return null
    const [events, savedSquad, players, team] = await Promise.all([
      listMatchEvents(db, matchId),
      getSquad(db, matchId),
      listPlayers(db, match.teamId),
      db.teams.get(match.teamId),
    ])
    const state = replay(matchId, events)
    const playersById = new Map(players.map((p) => [p.id, p]))
    const squadIds = state.squad.length > 0 ? state.squad : (savedSquad ?? [])
    return {
      match,
      events,
      state,
      squad: squadIds.flatMap((id) => playersById.get(id) ?? []),
      playersById,
      isController: state.controllerDeviceId === null || state.controllerDeviceId === scope.deviceId,
      testMode: Boolean(match.testMode) && isTestTeam(team),
    }
  }, [db, matchId, scope.deviceId])
}

/** Envía comandos al motor (transacción en IndexedDB) como este dispositivo y entrenador. */
export function useMatchDispatch(matchId: Id) {
  const { db, env, scope } = useApp()
  const coachId = useCoachId()
  return useCallback(
    (command: MatchCommand) => runMatchCommand(db, env, matchId, command, { deviceId: scope.deviceId, coachId }),
    [db, env, matchId, scope.deviceId, coachId],
  )
}
