import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth/AuthContext'
import { resetRequestError } from '../../app/auth/messages'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/TextField'
import { AuthLayout } from './AuthLayout'

/** Pide el correo para restablecer la contraseña (B-4). */
export function ForgotPasswordPage() {
  const { supabase } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim()) {
      setError('Escribe tu email.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: requestError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/restablecer`,
    })
    setBusy(false)
    // Mismo mensaje exista o no la cuenta: no se revela qué emails están registrados.
    // Solo se informa de: sin conexión, demasiados intentos o fallo del servidor al enviar.
    const failure = resetRequestError(requestError)
    if (failure) {
      setError(failure)
      return
    }
    setSent(true)
  }

  return (
    <AuthLayout title="RECUPERAR CONTRASEÑA">
      {sent ? (
        <p role="status" className="rounded-xl bg-panel p-4 text-lg">
          Si existe una cuenta con ese email, te hemos enviado un correo con un enlace para elegir una contraseña
          nueva. Revisa también la carpeta de spam.
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <p className="text-muted">Te enviaremos un correo con un enlace para elegir una contraseña nueva.</p>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && (
            <p role="alert" className="font-semibold text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            ENVIAR CORREO
          </Button>
        </form>
      )}
      <Link to="/login" className="text-center font-bold text-muted underline underline-offset-4">
        Volver a iniciar sesión
      </Link>
    </AuthLayout>
  )
}
