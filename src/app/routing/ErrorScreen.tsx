import { useEffect } from 'react'
import { Link, useRouteError } from 'react-router'
import { logError } from '../../data'
import { ClubCrest } from '../../ui/ClubCrest'
import { useAuth } from '../auth/AuthContext'

/** Pantalla ante un error inesperado de la interfaz: mensaje claro, error técnico al log. */
export function ErrorScreen() {
  const error = useRouteError()
  const { db } = useAuth()

  useEffect(() => {
    void logError(db, error, { at: 'route', path: window.location.pathname })
  }, [db, error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <ClubCrest size={72} className="ring-1 ring-accent/30" />
      <h1 className="text-2xl font-black">Algo no ha ido bien</h1>
      <p className="text-muted">Tus datos están guardados en el dispositivo. Vuelve al inicio para continuar.</p>
      <Link to="/" reloadDocument className="rounded-xl bg-accent px-6 py-4 text-lg font-bold text-accent-ink">
        VOLVER AL INICIO
      </Link>
    </main>
  )
}
