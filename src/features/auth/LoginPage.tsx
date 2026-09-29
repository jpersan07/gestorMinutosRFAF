import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../../app/auth/AuthContext'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/TextField'
import { AuthLayout } from './AuthLayout'

export function LoginPage() {
  const { status, notice, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (status.kind === 'needs-team') return <Navigate to="/entrar" replace />
  if (status.kind === 'ready' && !status.sessionLost) return <Navigate to="/" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('Escribe tu email y tu contraseña.')
      return
    }
    setBusy(true)
    setError(await signIn(email, password))
    setBusy(false)
  }

  return (
    <AuthLayout title="INICIAR SESIÓN">
      {notice && (
        <p role="status" className="rounded-xl bg-panel p-4 font-semibold text-warn">
          {notice}
        </p>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="font-semibold text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          ENTRAR
        </Button>
      </form>
      <Link to="/recuperar" className="text-center font-bold text-muted underline underline-offset-4">
        ¿Has olvidado la contraseña?
      </Link>
    </AuthLayout>
  )
}
