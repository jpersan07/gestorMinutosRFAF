export interface PitchSlotProps {
  /** 0 = izquierda, 100 = derecha. */
  readonly x: number
  /** 0 = portería propia (abajo), 100 = portería rival (arriba). */
  readonly y: number
  /** Etiqueta de la posición (POR, DFC…). */
  readonly role: string
  readonly player?: { readonly name: string; readonly number: number } | null
  readonly highlighted?: boolean
  readonly ariaLabel: string
  readonly onClick?: () => void
  /** Solo consulta: no es un botón (elemento de la lista "En el campo"). */
  readonly readOnly?: boolean
}

/** Posición en el campo: dorsal en un círculo y nombre debajo (o "+" y la posición si está vacía). */
export function PitchSlot({ x, y, role, player, highlighted = false, ariaLabel, onClick, readOnly = false }: PitchSlotProps) {
  // Margen en los bordes para que dorsal + nombre no se corten (portero abajo, delanteros arriba).
  const style = { left: `${x}%`, bottom: `calc(${y}% * 0.84 + 8%)` }
  const className = 'absolute flex w-[22%] -translate-x-1/2 translate-y-1/2 flex-col items-center gap-0.5 disabled:cursor-default'
  const content = (
    <>
      <span
        className={`tabular flex size-[clamp(2rem,14cqw,2.75rem)] items-center justify-center rounded-full text-[clamp(0.85rem,6cqw,1.125rem)] font-black shadow-lg transition ${
          player
            ? highlighted
              ? 'bg-warn text-accent-ink ring-4 ring-warn/40'
              : 'bg-line text-accent-ink'
            : 'border-2 border-dashed border-line/70 bg-black/20 text-line'
        }`}
      >
        {player ? player.number : '+'}
      </span>
      <span className="max-w-full truncate rounded bg-black/45 px-1 text-[clamp(0.6rem,3.6cqw,0.75rem)] font-bold leading-[1.6] text-line">
        {player ? player.name : role}
      </span>
    </>
  )
  if (readOnly) {
    return (
      <div role="listitem" aria-label={ariaLabel} style={style} className={className}>
        {content}
      </div>
    )
  }
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} disabled={!onClick} style={style} className={className}>
      {content}
    </button>
  )
}
