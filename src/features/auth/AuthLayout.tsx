import type { ReactNode } from 'react'

/** Pantallas de acceso: centradas, sin barra superior. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <div className="text-center">
        <p className="text-sm font-bold tracking-[0.3em] text-muted">GESTOR DE MINUTOS</p>
        <h1 className="mt-3 text-3xl font-black">{title}</h1>
      </div>
      {children}
    </main>
  )
}
