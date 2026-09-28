import { useEffect, useId, useRef, type ReactNode } from 'react'

export interface BottomSheetProps {
  readonly open: boolean
  readonly title: string
  readonly subtitle?: ReactNode
  readonly onClose: () => void
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/** Hoja inferior para elegir jugadores: al alcance del pulgar, contenido desplazable. */
export function BottomSheet({ open, title, subtitle, onClose, children, footer }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // Tocar fuera (el fondo) cierra la hoja.
        if (event.target === ref.current) onClose()
      }}
      className="mx-auto mb-0 mt-auto max-h-[85dvh] w-full max-w-xl rounded-t-3xl bg-panel p-0 text-line backdrop:bg-black/70"
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-start gap-3 px-4 pb-2 pt-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl font-black">
                {title}
              </h2>
              {subtitle && <div className="text-muted">{subtitle}</div>}
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl active:bg-panel-strong"
            >
              ✕
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
          {footer && <div className="border-t border-panel-strong px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
