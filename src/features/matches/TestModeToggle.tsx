import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useApp } from '../../app/context'
import { errorMessage } from '../../app/messages'
import { useAction } from '../../app/useAction'
import { isTestTeam, setTestMode, type MatchRecord } from '../../data'
import { Button } from '../../ui/Button'

/**
 * MODO PRUEBAS en la ficha del partido. SOLO aparece si el equipo (según el servidor) es "DEMO".
 * Se activa o desactiva antes de PLAY; después solo se indica que el partido es de pruebas.
 */
export function TestModeToggle({ match }: { match: MatchRecord }) {
  const { db, env } = useApp()
  const { run, busy, unexpected } = useAction()
  const [error, setError] = useState<string | null>(null)
  const team = useLiveQuery(() => db.teams.get(match.teamId), [db, match.teamId])
  if (!isTestTeam(team)) return null

  const active = Boolean(match.testMode)
  const beforePlay = match.status === 'scheduled' || match.status === 'setup'
  if (!beforePlay && !active) return null

  return (
    <section aria-label="Modo pruebas" className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-warn p-4">
      <p className="font-black text-warn">🧪 MODO PRUEBAS {active ? '· ACTIVADO' : ''}</p>
      <p className="text-sm text-muted">
        Solo para el equipo DEMO: permite adelantar el reloj del partido (+1, +5, +10 minutos, ir al descanso o al
        final) para probar el flujo completo. {beforePlay ? 'Se activa antes de empezar el partido.' : 'No es un partido real.'}
      </p>
      {beforePlay && (
        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          onClick={async () => {
            setError(null)
            const result = await run(() => setTestMode(db, env, match.id, !active))
            if (result && !result.ok) setError(errorMessage(result.error))
          }}
        >
          {active ? 'DESACTIVAR MODO PRUEBAS' : 'ACTIVAR MODO PRUEBAS'}
        </Button>
      )}
      {(error ?? unexpected) && (
        <p role="alert" className="text-sm font-bold text-danger">
          {error ?? unexpected}
        </p>
      )}
    </section>
  )
}
