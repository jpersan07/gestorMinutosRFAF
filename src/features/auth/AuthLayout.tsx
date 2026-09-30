import type { ReactNode } from 'react'
import { ClubCrest } from '../../ui/ClubCrest'

/** Pantallas de acceso: centradas, sin barra superior. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div className="flex flex-col items-center text-center">
        {/* Halo azul tras el escudo: el azul es el color de la app. */}
        <div className="rounded-full bg-accent/10 p-2 shadow-[0_0_48px_-8px] shadow-accent/40 ring-1 ring-accent/30">
          <ClubCrest size={96} />
        </div>
        <p className="mt-5 text-sm font-bold tracking-[0.3em] text-accent">GESTOR DE MINUTOS</p>
        <h1 className="mt-2 text-3xl font-black">{title}</h1>
      </div>
      {children}
    </main>
  )
}
