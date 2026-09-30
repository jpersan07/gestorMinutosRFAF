import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ClubCrest } from './ClubCrest'

export interface PageProps {
  readonly title: string
  /** Ruta a la que vuelve la flecha. Sin ella no hay botón de volver. */
  readonly back?: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}

/** Estructura común: barra superior + contenido centrado con margen lateral de 16 px. */
export function Page({ title, back, actions, children }: PageProps) {
  return (
    <div className="flex min-h-dvh flex-col pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-accent/15 bg-pitch/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
        {back && (
          <Link
            to={back}
            aria-label="Volver"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl active:bg-panel"
          >
            ←
          </Link>
        )}
        {/* El escudo del club, en todas las pantallas. */}
        <ClubCrest size={36} className={`ring-1 ring-accent/30 ${back ? '' : 'mx-1'}`} />
        <h1 className="min-w-0 flex-1 truncate text-xl font-black tracking-tight">{title}</h1>
        {actions}
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pb-6">{children}</main>
    </div>
  )
}
