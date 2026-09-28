import type { ReactNode } from 'react'

/**
 * Campo en vertical con la portería propia ABAJO. Los hijos se colocan con
 * coordenadas 0–100 (ver PitchSlot). Mantiene la proporción; el ancho lo decide quien lo usa.
 */
export function Pitch({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative aspect-[68/100] overflow-hidden rounded-2xl bg-[#14532d] [container-type:inline-size] ${className}`}>
      <svg
        viewBox="0 0 68 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 size-full"
        fill="none"
        stroke="rgba(232,245,236,0.35)"
        strokeWidth="0.4"
      >
        {[0, 1, 2, 3, 4].map((band) => (
          <rect key={band} x="0" y={band * 20} width="68" height="10" fill="rgba(255,255,255,0.03)" stroke="none" />
        ))}
        <rect x="2" y="2" width="64" height="96" />
        <line x1="2" y1="50" x2="66" y2="50" />
        <circle cx="34" cy="50" r="9" />
        {/* Área rival (arriba) y propia (abajo). */}
        <rect x="14" y="2" width="40" height="16" />
        <rect x="24" y="2" width="20" height="6" />
        <rect x="14" y="82" width="40" height="16" />
        <rect x="24" y="92" width="20" height="6" />
      </svg>
      {children}
    </div>
  )
}
