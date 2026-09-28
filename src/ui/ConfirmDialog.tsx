import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  readonly children?: ReactNode
  readonly confirmLabel: string
  readonly cancelLabel?: string
  readonly variant?: 'primary' | 'danger'
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/** Confirmación modal (elemento <dialog> nativo: foco y accesibilidad del navegador). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'CANCELAR',
  variant = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
        onCancel()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-panel p-5 text-line backdrop:bg-black/70"
    >
      {open && (
        <div className="flex flex-col gap-5">
          <h2 id={titleId} className="text-2xl font-black">
            {title}
          </h2>
          {children && <div className="flex flex-col gap-2 text-lg">{children}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant={variant} onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}
