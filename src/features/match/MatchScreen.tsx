import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router'
import { useApp } from '../../app/context'
import { useAutoTick } from '../../app/match/useAutoTick'
import { useMatch } from '../../app/match/useMatch'
import { useNow } from '../../app/match/useNow'
import { useWakeLock } from '../../app/match/useWakeLock'
import { useSync, useWatchMatch } from '../../app/sync/SyncContext'
import { matchClockOffset } from '../../data'
import { initialMatchState } from '../../domain'
import { Page } from '../../ui/Page'
import { HalftimePanel } from './HalftimePanel'
import { LivePanel } from './LivePanel'
import { LostControlScreen } from './LostControlScreen'
import { SetupScreen } from './SetupScreen'
import { ViewerScreen } from './ViewerScreen'

/** Pantalla de partido: su contenido es una función del estado del motor. */
export function MatchScreen() {
  const { matchId = '' } = useParams()
  const { env } = useApp()
  const view = useMatch(matchId)
  const deviceNow = useNow()
  const state = view?.state ?? initialMatchState(matchId)
  const live = state.status === 'first_half' || state.status === 'halftime' || state.status === 'second_half'
  const controlLost = Boolean(view?.match.controlLostAt)
  const controlling = Boolean(view?.isController) && !controlLost
  const { syncNow } = useSync()

  // Hora del partido: la del móvil corregida con la del servidor. Quien controla usa la
  // corrección congelada para su periodo de control (la misma que llevan sus eventos).
  const liveOffset = env.clockOffsetMs?.() ?? 0
  const offset = view && controlling ? matchClockOffset(view.match, view.events, liveOffset).ms : liveOffset
  const now = deviceNow + offset

  // Al abrir un partido se sincroniza inmediatamente (F3-6).
  useEffect(() => {
    void syncNow()
  }, [matchId, syncNow])

  // Modo consulta / control perdido: el partido se descarga cada 5 s mientras esté en pantalla.
  useWatchMatch(matchId, Boolean(view) && !controlling)
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

  // Otro dispositivo tomó el control: aviso hasta ENTENDIDO; después, modo consulta.
  if (controlLost && !view.match.controlLossAcknowledgedAt) return <LostControlScreen view={view} now={now} />
  if (state.status === 'finished' || state.status === 'saved') {
    return <Navigate to={`/partidos/${matchId}/resumen`} replace />
  }
  if (!controlling) return <ViewerScreen view={view} now={now} />

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
