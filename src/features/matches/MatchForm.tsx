import { useRef, useState, type FormEvent } from 'react'
import { useApp } from '../../app/context'
import { fileToCrestDataUrl } from '../../app/images'
import { fieldErrors } from '../../app/messages'
import { useAction } from '../../app/useAction'
import {
  createMatch,
  updateMatchDetails,
  type CrestChange,
  type DataError,
  type MatchRecord,
} from '../../data'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/TextField'

export interface MatchFormProps {
  /** null = NUEVO PARTIDO. */
  readonly match: MatchRecord | null
  /** Escudo actual (data URL) para la vista previa al editar. */
  readonly currentCrest: string | null
  readonly onSaved: (match: MatchRecord) => void
}

/** Formulario común de NUEVO PARTIDO y EDITAR. Solo el rival es obligatorio. */
export function MatchForm({ match, currentCrest, onSaved }: MatchFormProps) {
  const { db, env, scope } = useApp()
  const { run, busy, unexpected } = useAction()
  const fileInput = useRef<HTMLInputElement>(null)
  const [opponent, setOpponent] = useState(match?.opponent ?? '')
  const [matchDate, setMatchDate] = useState(match?.matchDate ?? '')
  const [kickoffTime, setKickoffTime] = useState(match?.kickoffTime ?? '')
  const [location, setLocation] = useState(match?.location ?? '')
  const [crest, setCrest] = useState<CrestChange>(undefined)
  const [crestError, setCrestError] = useState<string | null>(null)
  const [error, setError] = useState<DataError | null>(null)
  const errors = fieldErrors(error)
  const preview = crest === undefined ? currentCrest : crest

  async function pickCrest(file: File | undefined) {
    if (!file) return
    setCrestError(null)
    try {
      setCrest(await fileToCrestDataUrl(file))
    } catch {
      setCrestError('No se ha podido leer la imagen. Prueba con otra.')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const details = { opponent, matchDate, kickoffTime, location, crest }
    const result = await run(() =>
      match
        ? updateMatchDetails(db, env, match.id, details)
        : createMatch(db, env, { teamId: scope.teamId, seasonId: scope.seasonId }, details),
    )
    if (!result) return
    if (result.ok) onSaved(result.value)
    else setError(result.error)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <TextField
        label="Club / equipo rival"
        value={opponent}
        onChange={(e) => setOpponent(e.target.value)}
        autoComplete="off"
        autoCapitalize="words"
        error={errors.opponent}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold uppercase tracking-wide text-muted">Escudo</span>
        <div className="flex items-center gap-4">
          {preview ? (
            <img src={preview} alt="Escudo" className="size-20 rounded-full bg-line object-cover" />
          ) : (
            <span className="flex size-20 items-center justify-center rounded-full border-2 border-dashed border-panel-strong text-sm text-muted">
              Sin escudo
            </span>
          )}
          <div className="flex flex-1 flex-col gap-2">
            <Button variant="secondary" size="md" onClick={() => fileInput.current?.click()}>
              {preview ? 'CAMBIAR' : 'ELEGIR IMAGEN'}
            </Button>
            {preview && (
              <Button variant="ghost" size="md" onClick={() => setCrest(null)}>
                Quitar escudo
              </Button>
            )}
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Imagen del escudo"
          onChange={(e) => void pickCrest(e.target.files?.[0])}
        />
        {crestError && <p className="text-sm font-semibold text-danger">{crestError}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Fecha"
          type="date"
          value={matchDate}
          onChange={(e) => setMatchDate(e.target.value)}
          error={errors.matchDate}
        />
        <TextField
          label="Hora"
          type="time"
          value={kickoffTime}
          onChange={(e) => setKickoffTime(e.target.value)}
          error={errors.kickoffTime}
        />
      </div>
      <TextField
        label="Ubicación"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        autoComplete="off"
        hint="Fecha, hora, ubicación y escudo se pueden completar más tarde."
      />

      {unexpected && <p className="font-semibold text-danger">{unexpected}</p>}
      <Button type="submit" disabled={busy}>
        {match ? 'GUARDAR CAMBIOS' : 'CREAR PARTIDO'}
      </Button>
    </form>
  )
}
