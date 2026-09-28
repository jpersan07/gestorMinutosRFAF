import { useEffect, useState } from 'react'

/**
 * Hora actual para PINTAR el cronómetro. Solo provoca re-renders: el tiempo de partido
 * siempre se calcula desde los timestamps guardados, nunca contando ticks.
 * Se refresca al instante al volver a la app (pantalla bloqueada, cambio de app).
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, intervalMs)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('pageshow', update)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('pageshow', update)
      window.removeEventListener('focus', update)
    }
  }, [intervalMs])
  return now
}
