import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp, useCoachId } from '../../app/context'
import { useAction } from '../../app/useAction'
import { saveReport, type MatchReportRecord, type ReportInput } from '../../data'
import type { Id } from '../../domain'

const AUTOSAVE_MS = 300

/**
 * Estado del informe con guardado automático en el dispositivo mientras se escribe.
 * También guarda al pasar la app a segundo plano o cerrar la página.
 */
export function useReportDraft(matchId: Id, initial: MatchReportRecord | null, editable: boolean) {
  const { db, env } = useApp()
  const coachId = useCoachId()
  const { run, unexpected } = useAction()
  const [values, setValues] = useState<ReportInput>({
    result: initial?.result ?? '',
    observations: initial?.observations ?? '',
  })
  const [saved, setSaved] = useState(true)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(values)
  /** Versión de lo escrito: un guardado solo marca "guardado" si no hubo cambios mientras tanto. */
  const version = useRef(0)
  const savedVersion = useRef(0)

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current)
    if (!editable) return true
    if (savedVersion.current === version.current) return true
    const saving = version.current
    const result = await run(() => saveReport(db, env, matchId, latest.current, coachId))
    if (!result?.ok) return false
    savedVersion.current = Math.max(savedVersion.current, saving)
    if (savedVersion.current === version.current) setSaved(true)
    return true
  }, [db, env, matchId, coachId, editable, run])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => void flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.clearTimeout(timer.current)
      void flush()
    }
  }, [flush])

  const change = useCallback(
    (patch: Partial<ReportInput>) => {
      const next = { ...latest.current, ...patch }
      latest.current = next
      version.current += 1
      setValues(next)
      setSaved(false)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    },
    [flush],
  )

  return { values, change, flush, saved, unexpected }
}
