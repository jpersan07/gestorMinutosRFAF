import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useAuth } from '../../app/auth/AuthContext'
import { authErrorMessage, isNetworkError } from '../../app/auth/messages'
import {
  applyTeamContext,
  discardReasonFor,
  getLocalAccount,
  loadMemberships,
  loadTeamContext,
  logError,
  summarizeLocalData,
  wipeLocalData,
  type DiscardReason,
  type LocalDataSummary,
  type Membership,
  type TeamContext,
} from '../../data'
import { Button } from '../../ui/Button'
import { AuthLayout } from './AuthLayout'

type ReadyContext = TeamContext & { readonly season: NonNullable<TeamContext['season']> }

type Step =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'no-team' }
  | { readonly kind: 'pick'; readonly memberships: readonly Membership[] }
  | { readonly kind: 'no-season'; readonly teamName: string }
  | {
      readonly kind: 'confirm-discard'
      readonly reason: DiscardReason
      readonly summary: LocalDataSummary
      readonly context: ReadyContext
    }

function describe(summary: LocalDataSummary): string {
  const parts = [
    summary.players > 0 ? `${summary.players} ${summary.players === 1 ? 'jugador' : 'jugadores'}` : null,
    summary.matches > 0 ? `${summary.matches} ${summary.matches === 1 ? 'partido' : 'partidos'}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' y ') : 'datos de partidos'
}

/**
 * Tras iniciar sesión: equipos de la cuenta (elegir si hay varios, B-3), temporada activa y, si el
 * móvil tiene datos incompatibles (pruebas de la Fase 2 u otro equipo), aviso con UNA confirmación.
 */
export function TeamSetupPage() {
  const { db, env, supabase, status, signOut, enterTeam } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const userId = status.kind === 'needs-team' ? status.userId : null

  const fail = useCallback(
    async (error: unknown) => {
      if (!isNetworkError(error)) await logError(db, error, { at: 'teamSetup' })
      setStep({ kind: 'error', message: authErrorMessage(error, 'team') })
    },
    [db],
  )

  const finish = useCallback(
    async (context: ReadyContext) => {
      if (!userId) return
      const scope = await applyTeamContext(db, env, userId, context)
      enterTeam(scope)
      navigate('/', { replace: true })
    },
    [db, env, userId, enterTeam, navigate],
  )

  const chooseTeam = useCallback(
    async (teamId: string) => {
      setStep({ kind: 'loading' })
      try {
        const context = await loadTeamContext(supabase, teamId)
        if (!context.season) {
          setStep({ kind: 'no-season', teamName: context.team.name })
          return
        }
        const ready: ReadyContext = { ...context, season: context.season }
        const summary = await summarizeLocalData(db)
        const reason = discardReasonFor(await getLocalAccount(db), summary, teamId)
        if (reason) setStep({ kind: 'confirm-discard', reason, summary, context: ready })
        else await finish(ready)
      } catch (error) {
        await fail(error)
      }
    },
    [supabase, db, finish, fail],
  )

  // Intento de carga: REINTENTAR lo incrementa y vuelve a lanzar la carga.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadMemberships(supabase, userId).then(
      (memberships) => {
        if (cancelled) return
        if (memberships.length === 0) setStep({ kind: 'no-team' })
        else if (memberships.length === 1) void chooseTeam(memberships[0]!.teamId)
        else setStep({ kind: 'pick', memberships })
      },
      (error: unknown) => {
        if (!cancelled) void fail(error)
      },
    )
    return () => {
      cancelled = true
    }
  }, [supabase, userId, attempt, chooseTeam, fail])

  const retry = () => {
    setStep({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }

  if (status.kind === 'signed-out') return <Navigate to="/login" replace />
  if (status.kind === 'ready') return <Navigate to="/" replace />

  const leave = () => void signOut()

  return (
    <AuthLayout title="ENTRAR EN EL EQUIPO">
      {step.kind === 'loading' && <p className="text-center text-muted">Cargando tu equipo…</p>}

      {step.kind === 'error' && (
        <div className="flex flex-col gap-4">
          <p role="alert" className="rounded-xl bg-panel p-4 font-semibold">
            {step.message}
          </p>
          <Button onClick={retry}>REINTENTAR</Button>
          <Button variant="ghost" onClick={leave}>
            Cerrar sesión
          </Button>
        </div>
      )}

      {step.kind === 'no-team' && (
        <div className="flex flex-col gap-4">
          <p role="alert" className="rounded-xl bg-panel p-4 font-semibold">
            Tu cuenta no pertenece a ningún equipo. Pide al administrador que te añada.
          </p>
          <Button variant="secondary" onClick={leave}>
            CERRAR SESIÓN
          </Button>
        </div>
      )}

      {step.kind === 'no-season' && (
        <div className="flex flex-col gap-4">
          <p role="alert" className="rounded-xl bg-panel p-4 font-semibold">
            El equipo {step.teamName} no tiene una temporada activa. Pide al administrador que la configure.
          </p>
          <Button variant="secondary" onClick={leave}>
            CERRAR SESIÓN
          </Button>
        </div>
      )}

      {step.kind === 'pick' && (
        <div className="flex flex-col gap-3">
          <p className="text-center text-muted">¿Con qué equipo vas a trabajar?</p>
          {step.memberships.map((m) => (
            <Button key={m.teamId} className="min-h-16 text-xl" onClick={() => void chooseTeam(m.teamId)}>
              {m.teamName}
            </Button>
          ))}
          <Button variant="ghost" onClick={leave}>
            Cerrar sesión
          </Button>
        </div>
      )}

      {step.kind === 'confirm-discard' && (
        <div role="alertdialog" aria-labelledby="discard-title" className="flex flex-col gap-4 rounded-2xl bg-panel p-5">
          <h2 id="discard-title" className="text-xl font-black">
            {step.reason === 'test-data' ? 'Datos de prueba en este móvil' : 'Datos de otro equipo en este móvil'}
          </h2>
          <p className="text-lg">
            {step.reason === 'test-data'
              ? `Este móvil tiene datos de prueba de la versión anterior (${describe(step.summary)}).`
              : `Este móvil tiene datos de otro equipo (${describe(step.summary)}).`}{' '}
            Para empezar con los datos de <strong>{step.context.team.name}</strong> se borrarán de este dispositivo.
          </p>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await wipeLocalData(db)
                await finish(step.context)
              } catch (error) {
                await fail(error)
              } finally {
                setBusy(false)
              }
            }}
          >
            BORRAR Y CONTINUAR
          </Button>
          <Button variant="secondary" disabled={busy} onClick={leave}>
            CANCELAR (no borrar y cerrar sesión)
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}
