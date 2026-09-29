import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../../app/context'
import type { MatchView } from '../../app/match/useMatch'
import { OfflineNotice } from '../../app/sync/ConnectionNotice'
import { Page } from '../../ui/Page'
import { MatchReadOnly } from './MatchReadOnly'
import { TakeControlButton } from './TakeControlButton'

/** MODO CONSULTA: el partido lo controla otro dispositivo. Solo lectura y TOMAR CONTROL. */
export function ViewerScreen({ view, now }: { view: MatchView; now: number }) {
  const { db } = useApp()
  const manager = useLiveQuery(
    async () => (view.match.managedBy ? await db.profiles.get(view.match.managedBy) : undefined),
    [db, view.match.managedBy],
  )

  return (
    <Page title="PARTIDO" back={`/partidos/${view.match.id}`}>
      <p className="rounded-xl bg-panel p-3 text-center font-bold">
        MODO CONSULTA · Lo está gestionando {manager ? manager.displayName : 'otro entrenador'} desde otro dispositivo.
      </p>
      <OfflineNotice />
      <MatchReadOnly view={view} now={now} />
      <TakeControlButton view={view} />
    </Page>
  )
}
