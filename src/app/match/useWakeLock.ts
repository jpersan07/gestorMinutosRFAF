import { useEffect } from 'react'

/**
 * Intenta mantener la pantalla encendida (Screen Wake Lock API). El navegador lo libera
 * al ocultar la página, así que se vuelve a pedir al volver. Si no hay soporte o se
 * deniega, no pasa nada: el cronómetro no depende de que la pantalla esté encendida.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const request = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) void lock.release()
        else sentinel = lock
      } catch {
        // Denegado (ahorro de batería, iframe…): se ignora.
      }
    }

    void request()
    document.addEventListener('visibilitychange', request)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', request)
      void sentinel?.release()
    }
  }, [active])
}
