import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router'
import { useAutoTick } from '../../app/match/useAutoTick'
import { useMatch } from '../../app/match/useMatch'
import { useNow } from '../../app/match/useNow'
import { useWakeLock } from '../../app/match/useWakeLock'
import { useSync } from '../../app/sync/SyncContext'
import { initialMatchState } from '../../domain'
import { Page } from '../../ui/Page'
import { HalftimePanel } from './HalftimePanel'
import { LivePanel } from './LivePanel'
import { LostControlScreen } from './LostControlScreen'
import { SetupScreen } from './SetupScreen'
import { TakeControl } from './TakeControl'

/** Pantalla de partido: su contenido es una función del estado del motor. */
export function MatchScreen() {
  const { matchId = '' } = useParams()
  const view = useMatch(matchId)
  const now = useNow()
  const state = view?.state ?? initialMatchState(matchId)
  const live = state.status === 'first_half' || state.status === 'halftime' || state.status === 'second_half'
  const controlLost = Boolean(view?.match.controlLostAt)
  const controlling = Boolean(view?.isController) && !controlLost
  const { syncNow } = useSync()

  // Al abrir un partido se sincroniza inmediatamente (F3-6).
  useEffect(() => {
    void syncNow()
  }, [matchId, syncNow])

  // Los finales de parte los registra el dispositivo que controla el partido.
  useAutoTick(state, now, live && controlling)
  // Pantalla encendida mientras el partido está en juego o en el descanso.
  useWakeLock(live && controlling)

  if (view === undefined) return null
  if (view === null) {
    return (
      <Page title="PARTIDO" back="/partidos">
        <p className="text-muted">No se ha encontrado el partido.</p>
      </Page>
    )
  }

  // Otro dispositivo tomó el control: esta pantalla sustituye a la de juego (solo lectura).
  if (controlLost) return <LostControlScreen view={view} />
  if (state.status === 'finished' || state.status === 'saved') {
    return <Navigate to={`/partidos/${matchId}/resumen`} replace />
  }
  if (!view.isController) return <TakeControl view={view} />

  switch (state.status) {
    case 'scheduled':
    case 'setup':
      return <SetupScreen view={view} />
    case 'first_half':
    case 'second_half':
      return <LivePanel view={view} now={now} />
    case 'halftime':
      return <HalftimePanel view={view} now={now} />
  }
}
