import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useApp, useCoachId } from '../../app/context'
import { useMatch, type MatchView } from '../../app/match/useMatch'
import { errorMessage } from '../../app/messages'
import { useAction } from '../../app/useAction'
import { getReport, saveMatch, type MatchReportRecord } from '../../data'
import { buildMatchSummary } from '../../domain'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Page } from '../../ui/Page'
import { MatchSummaryView } from './MatchSummaryView'
import { ReportForm } from './ReportForm'
import { useReportDraft } from './useReportDraft'

type SaveStep = 'idle' | 'first' | 'second'

function Summary({ view, initialReport }: { view: MatchView; initialReport: MatchReportRecord | null }) {
  const { db, env, scope } = useApp()
  const coachId = useCoachId()
  const navigate = useNavigate()
  const { run, busy, unexpected } = useAction()
  const finished = view.state.status === 'finished'
  const report = useReportDraft(view.match.id, initialReport, finished)
  const [step, setStep] = useState<SaveStep>('idle')
  const [resultError, setResultError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Partido finalizado o guardado: los minutos llegan al 90' y no dependen de la hora actual.
  const summary = buildMatchSummary(view.match.id, view.events, view.match.updatedAt)

  async function startSave() {
    setError(null)
    if (report.values.result.trim() === '') {
      setResultError('Escribe el RESULTADO antes de guardar.')
      return
    }
    setResultError(null)
    if (await report.flush()) setStep('first')
  }

  async function saveForGood() {
    const result = await run(() => saveMatch(db, env, view.match.id, { deviceId: scope.deviceId, coachId }))
    setStep('idle')
    if (result && !result.ok) setError(errorMessage(result.error))
  }

  return (
    <Page title="RESUMEN" back={`/partidos/${view.match.id}`}>
      <section className="flex flex-col items-center gap-1 rounded-2xl bg-panel p-4 text-center">
        {finished ? (
          <p className="text-sm font-bold tracking-[0.2em] text-muted">PARTIDO FINALIZADO</p>
        ) : (
          <p className="text-lg font-black text-accent">✓ PARTIDO GUARDADO</p>
        )}
        <p className="text-2xl font-black uppercase">{view.match.opponent}</p>
        {!finished && report.values.result && <p className="text-4xl font-black">{report.values.result}</p>}
      </section>

      {!finished && (
        <Button onClick={() => navigate('/partidos')}>VOLVER A PARTIDOS</Button>
      )}

      <MatchSummaryView summary={summary} playersById={view.playersById} />

      <ReportForm
        values={report.values}
        readOnly={!finished}
        resultError={resultError}
        status={finished ? (report.unexpected ?? (report.saved ? 'Guardado en el dispositivo.' : 'Guardando…')) : null}
        onChange={(patch) => {
          if (patch.result?.trim()) setResultError(null)
          report.change(patch)
        }}
        onBlur={() => void report.flush()}
      />

      {finished && (
        <>
          {(error ?? unexpected) && <p className="font-semibold text-danger">{error ?? unexpected}</p>}
          <Button className="min-h-16 text-xl" disabled={busy} onClick={() => void startSave()}>
            GUARDAR PARTIDO
          </Button>
        </>
      )}

      <ConfirmDialog
        open={step === 'first'}
        title="¿Guardar partido?"
        confirmLabel="CONTINUAR"
        onCancel={() => setStep('idle')}
        onConfirm={() => setStep('second')}
      >
        <p>Se guardarán definitivamente:</p>
        <ul className="list-inside list-disc text-muted">
          <li>alineaciones</li>
          <li>cambios</li>
          <li>minutos</li>
          <li>resultado</li>
          <li>informe</li>
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={step === 'second'}
        title="¿ESTÁS SEGURO?"
        cancelLabel="VOLVER"
        confirmLabel="GUARDAR DEFINITIVAMENTE"
        busy={busy}
        onCancel={() => setStep('idle')}
        onConfirm={() => void saveForGood()}
      >
        <p>Esta acción marcará el partido como GUARDADO y ya no se podrá modificar.</p>
      </ConfirmDialog>
    </Page>
  )
}

/** Resumen + informe (partido finalizado) o consulta de solo lectura (guardado). */
export function SummaryPage() {
  const { matchId = '' } = useParams()
  const { db } = useApp()
  const view = useMatch(matchId)
  const report = useLiveQuery(() => getReport(db, matchId), [db, matchId], 'loading' as const)

  if (view === undefined || report === 'loading') return null
  if (view === null) return <Navigate to="/partidos" replace />
  if (view.state.status !== 'finished' && view.state.status !== 'saved') {
    return <Navigate to={`/partidos/${matchId}`} replace />
  }
  return <Summary key={matchId} view={view} initialReport={report} />
}
