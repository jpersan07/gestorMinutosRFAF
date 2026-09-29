import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AppDatabase,
  applyTeamContext,
  createSupabase,
  findActiveMatchId,
  getDeviceId,
  getLocalAccount,
  loadMemberships,
  loadTeamContext,
  localScopeFor,
  logError,
  systemEnv,
  type AppScope,
} from '../data'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth/AuthContext'
import { authErrorMessage } from './auth/messages'
import { discardUnfinishedRecovery, readStoredSession } from './auth/session'
import { resolveStartup } from './auth/startup'

const db = new AppDatabase()
const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase = url && publishableKey ? createSupabase(url, publishableKey) : null

type BootState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'running'; readonly deviceId: string; readonly status: AuthStatus }
  | { readonly phase: 'storage-error' }

function FullScreenMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-black">{title}</h1>
      <p className="text-muted">{children}</p>
    </main>
  )
}

/**
 * Abre la base de datos local, lee la sesión guardada (sin esperar a la red) y decide si se
 * entra directamente, se elige equipo o se inicia sesión.
 */
export function Boot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BootState>({ phase: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)
  const deviceId = state.phase === 'running' ? state.deviceId : null

  const setStatus = useCallback((status: AuthStatus) => {
    setState((current) => (current.phase === 'running' ? { ...current, status } : current))
  }, [])

  // Arranque: solo datos del dispositivo.
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    ;(async () => {
      try {
        void navigator.storage?.persist?.()
        const device = await getDeviceId(db, systemEnv)
        await discardUnfinishedRecovery(supabase)
        const session = await readStoredSession(supabase)
        const account = await getLocalAccount(db)
        const localScope = account.userId ? await localScopeFor(db, device, account.userId) : null
        const liveMatch = localScope ? (await findActiveMatchId(db, device)) !== null : false
        const decision = resolveStartup({ session, localScope, liveMatch })
        if (!cancelled) setState({ phase: 'running', deviceId: device, status: decision })
      } catch (error) {
        await logError(db, error, { at: 'boot' })
        if (!cancelled) setState({ phase: 'storage-error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Cambios de sesión: entrada o sesión revocada/caducada. (El cierre voluntario ya deja el
  // estado en 'signed-out' antes de que llegue su SIGNED_OUT, así que se ignora aquí.)
  useEffect(() => {
    if (!supabase || !deviceId) return
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Recomendación de supabase-js: no llamar a la API dentro del callback.
      setTimeout(async () => {
        if (event === 'SIGNED_IN' && session) {
          setState((current) => {
            if (current.phase !== 'running') return current
            const status = current.status
            if (status.kind === 'ready' && status.scope.userId === session.user.id) {
              return { ...current, status: { ...status, sessionLost: false } }
            }
            if (status.kind === 'ready') return current
            return { ...current, status: { kind: 'needs-team', userId: session.user.id } }
          })
        }
        if (event === 'SIGNED_OUT') {
          // B-5: con un partido en juego no se expulsa al entrenador; solo se avisa.
          const liveMatch = (await findActiveMatchId(db, deviceId)) !== null
          let expelled = false
          setState((current) => {
            if (current.phase !== 'running' || current.status.kind === 'signed-out') return current
            if (current.status.kind === 'ready' && liveMatch) {
              return { ...current, status: { ...current.status, sessionLost: true } }
            }
            expelled = true
            return { ...current, status: { kind: 'signed-out' } }
          })
          if (expelled) setNotice('Tu sesión ha caducado. Vuelve a iniciar sesión.')
        }
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [deviceId])

  const signOut = useCallback(
    async (message?: string) => {
      if (!supabase) return
      setNotice(message ?? null)
      setStatus({ kind: 'signed-out' })
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch (error) {
        await logError(db, error, { at: 'signOut' })
      }
    },
    [setStatus],
  )

  // Con conexión, se refresca el contexto del equipo en segundo plano (nombre, temporada, compañeros).
  const readyScope =
    state.phase === 'running' && state.status.kind === 'ready' && !state.status.sessionLost ? state.status.scope : null
  useEffect(() => {
    if (!supabase || !readyScope || !deviceId) return
    const scope = readyScope
    const refresh = async () => {
      if (!navigator.onLine) return
      try {
        const memberships = await loadMemberships(supabase, scope.userId)
        if (!memberships.some((m) => m.teamId === scope.teamId)) {
          if ((await findActiveMatchId(db, deviceId)) === null) {
            await signOut('Tu cuenta ya no pertenece a este equipo. Habla con el administrador.')
          }
          return
        }
        const context = await loadTeamContext(supabase, scope.teamId)
        if (!context.season) return
        const next: AppScope = await applyTeamContext(db, systemEnv, scope.userId, { ...context, season: context.season })
        if (next.seasonId !== scope.seasonId) setStatus({ kind: 'ready', scope: next, sessionLost: false })
      } catch {
        // Sin red o error temporal: se reintentará al volver la conexión.
      }
    }
    void refresh()
    window.addEventListener('online', refresh)
    return () => window.removeEventListener('online', refresh)
  }, [readyScope, deviceId, signOut, setStatus])

  /** Hay una sesión nueva de `userId`: misma cuenta → se sigue; otra → elegir equipo. */
  const adoptSession = useCallback((userId: string) => {
    setNotice(null)
    setState((current) => {
      if (current.phase !== 'running') return current
      const status = current.status
      if (status.kind === 'ready' && status.scope.userId === userId) {
        return { ...current, status: { ...status, sessionLost: false } }
      }
      return { ...current, status: { kind: 'needs-team', userId } }
    })
  }, [])

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return 'La app no está configurada.'
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error || !data.user) return authErrorMessage(error, 'login')
      adoptSession(data.user.id)
      return null
    },
    [adoptSession],
  )

  const enterTeam = useCallback((scope: AppScope) => setStatus({ kind: 'ready', scope, sessionLost: false }), [setStatus])

  const value = useMemo<AuthContextValue | null>(
    () =>
      supabase && state.phase === 'running'
        ? {
            db,
            env: systemEnv,
            supabase,
            deviceId: state.deviceId,
            status: state.status,
            notice,
            signIn,
            signOut,
            completePasswordRecovery: adoptSession,
            enterTeam,
          }
        : null,
    [state, notice, signIn, signOut, adoptSession, enterTeam],
  )

  if (!supabase) {
    return (
      <FullScreenMessage title="Falta configuración">
        La app no tiene configurado el servidor (VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY).
      </FullScreenMessage>
    )
  }
  if (state.phase === 'storage-error') {
    return (
      <FullScreenMessage title="No se pueden guardar datos">
        Este navegador no permite guardar datos en el dispositivo (¿modo privado?). Abre la app en una ventana normal o
        instálala en la pantalla de inicio.
      </FullScreenMessage>
    )
  }
  if (!value) return <main className="min-h-dvh" aria-busy="true" />
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
