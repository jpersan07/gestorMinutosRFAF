import { useState } from 'react'
import { useAuth } from '../../app/auth/AuthContext'
import { useSync } from '../../app/sync/SyncContext'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'

/** Tiempo máximo que se espera a la subida antes de cerrar sesión. */
const SYNC_BEFORE_SIGN_OUT_MS = 10_000

/**
 * CERRAR SESIÓN (C-3): si hay cambios sin subir, se dice cuántos y se ofrece SINCRONIZAR AHORA;
 * con conexión se intenta subirlos antes de cerrar. Nunca se borra nada del móvil (B-2).
 */
export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOut } = useAuth()
  const { status, syncNow } = useSync()
  const [busy, setBusy] = useState(false)
  const { pending, online } = status

  const syncWithTimeout = () =>
    Promise.race([syncNow(), new Promise((resolve) => setTimeout(resolve, SYNC_BEFORE_SIGN_OUT_MS))])

  return (
    <ConfirmDialog
      open={open}
      title="¿Cerrar sesión?"
      confirmLabel="CERRAR SESIÓN"
      busy={busy}
      onCancel={onClose}
      onConfirm={async () => {
        setBusy(true)
        if (pending > 0 && online) await syncWithTimeout()
        setBusy(false)
        onClose()
        await signOut()
      }}
    >
      {pending > 0 ? (
        <>
          <p className="font-bold">
            {pending === 1 ? 'Hay 1 cambio sin subir al servidor.' : `Hay ${pending} cambios sin subir al servidor.`}
          </p>
          <p>
            {online
              ? 'Se intentará subirlos antes de cerrar la sesión. Si no se puede, se conservan en este móvil.'
              : 'Sin conexión: se conservan en este móvil y se subirán cuando vuelvas a entrar con conexión.'}
          </p>
          <Button
            variant="secondary"
            size="md"
            disabled={!online || busy || status.syncing}
            onClick={async () => {
              setBusy(true)
              await syncWithTimeout()
              setBusy(false)
            }}
          >
            SINCRONIZAR AHORA
          </Button>
        </>
      ) : (
        <p>Los datos de este móvil se conservan y volverán a estar disponibles al entrar con tu cuenta.</p>
      )}
    </ConfirmDialog>
  )
}
