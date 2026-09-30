/** Escudo del club (logo de la app). Imagen local: funciona sin conexión (precache del service worker). */
export function ClubCrest({ size, className = '' }: { size: number; className?: string }) {
  return (
    <img
      src="/escudo.png"
      alt="C.D.F. Romeral"
      width={size}
      height={size}
      decoding="async"
      className={`shrink-0 select-none rounded-full ${className}`}
      draggable={false}
    />
  )
}
