import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink',
  secondary: 'bg-panel-strong text-line',
  danger: 'bg-danger text-danger-ink',
  ghost: 'bg-transparent text-line underline-offset-4 hover:underline',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant
  /** Botones grandes para usar con el pulgar. */
  readonly size?: 'lg' | 'md'
}

export function Button({ variant = 'primary', size = 'lg', className = '', type = 'button', ...props }: ButtonProps) {
  const sizing = size === 'lg' ? 'min-h-14 px-5 text-lg' : 'min-h-11 px-4 text-base'
  return (
    <button
      type={type}
      className={`${sizing} ${VARIANTS[variant]} inline-flex items-center justify-center gap-2 rounded-xl font-bold tracking-wide transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${className}`}
      {...props}
    />
  )
}
