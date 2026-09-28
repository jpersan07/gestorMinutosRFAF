import { useId, type TextareaHTMLAttributes } from 'react'

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label: string
}

export function TextArea({ label, className = '', ...props }: TextAreaProps) {
  const id = useId()
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-bold uppercase tracking-wide text-muted">
        {label}
      </label>
      <textarea
        id={id}
        rows={6}
        className="rounded-xl border-2 border-panel-strong bg-panel px-4 py-3 text-lg text-line outline-none focus:border-accent disabled:opacity-70"
        {...props}
      />
    </div>
  )
}
