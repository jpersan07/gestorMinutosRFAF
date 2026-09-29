import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../../app/auth/AuthContext'
import { authErrorMessage } from '../../app/auth/messages'
import { markRecoveryPending } from '../../app/auth/session'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/TextField'
import { AuthLayout } from './AuthLayout'

const MIN_LENGTH = 8

type Step = 'verifying' | 'invalid' | 'form' | 'done'

/**
 * Enlace del correo de recuperación (B-4): /restablecer?token_hash=…&type=recovery.
 * Se valida con verifyOtp (funciona aunque el enlace se abra en otro navegador).
 */
export function ResetPasswordPage() {
  const { supabase, completePasswordRecovery } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tokenHash = params.get('type') === 'recovery' ? params.get('token_hash') : null
  const [step, setStep] = useState<Step>(tokenHash ? 'verifying' : 'invalid')
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const verified = useRef(false)
  const recoverySession = useRef(false)
  const completed = useRef(false)

  // La sesión del enlace de recuperación solo sirve para cambiar la contraseña: si se abandona la
  // pantalla sin terminar, se cierra en este navegador.
  useEffect(
    () => () => {
      if (recoverySession.current && !completed.current) {
        markRecoveryPending(false)
        void supabase.auth.signOut({ scope: 'local' })
      }
    },
    [supabase],
  )

  useEffect(() => {
    // El enlace solo vale una vez: no se valida dos veces (React StrictMode ejecuta los efectos dos veces).
    if (!tokenHash || verified.current) return
    verified.current = true
    void supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ error: verifyError }) => {
      if (verifyError) {
        setError(authErrorMessage(verifyError, 'reset-verify'))
        setStep('invalid')
      } else {
        recoverySession.current = true
        markRecoveryPending(true)
        setStep('form')
      }
    })
  }, [tokenHash, supabase])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`)
      return
    }
    if (password !== repeat) {
      setError('Las dos contraseñas no coinciden.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError || !data.user) {
      setError(authErrorMessage(updateError, 'reset-update'))
      return
    }
    completed.current = true
    markRecoveryPending(false)
    completePasswordRecovery(data.user.id)
    setStep('done')
  }

  return (
    <AuthLayout title="NUEVA CONTRASEÑA">
      {step === 'verifying' && <p className="text-center text-muted">Comprobando el enlace…</p>}

      {step === 'invalid' && (
        <div className="flex flex-col gap-4">
          <p role="alert" className="rounded-xl bg-panel p-4 font-semibold text-danger">
            {error ?? 'El enlace no es válido. Pide otro correo.'}
          </p>
          <Link to="/recuperar" className="text-center font-bold underline underline-offset-4">
            Pedir otro correo
          </Link>
        </div>
      )}

      {step === 'form' && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <TextField
            label="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={`Al menos ${MIN_LENGTH} caracteres.`}
          />
          <TextField
            label="Repite la contraseña"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
          {error && (
            <p role="alert" className="font-semibold text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            GUARDAR CONTRASEÑA
          </Button>
        </form>
      )}

      {step === 'done' && (
        <div className="flex flex-col gap-4">
          <p role="status" className="rounded-xl bg-panel p-4 text-lg font-semibold">
            ✓ Contraseña cambiada. Ya puedes usar la nueva en todos tus dispositivos.
          </p>
          <Button onClick={() => navigate('/', { replace: true })}>ENTRAR EN LA APP</Button>
        </div>
      )}
    </AuthLayout>
  )
}
