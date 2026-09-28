function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase('es'))
    .join('')
}

/** Escudo del rival; sin imagen, sus iniciales. */
export function Crest({ dataUrl, name, size = 48 }: { dataUrl: string | null; name: string; size?: number }) {
  const style = { width: size, height: size }
  if (dataUrl) {
    return <img src={dataUrl} alt={`Escudo de ${name}`} style={style} className="shrink-0 rounded-full bg-line object-cover" />
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...style, fontSize: size * 0.36 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-panel-strong font-black text-muted"
    >
      {initials(name)}
    </span>
  )
}
