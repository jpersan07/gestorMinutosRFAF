import type { EpochMs, Id, MatchEvent } from '../../domain'
import type { AppDatabase, MatchRecord } from '../db'
import type { DataEnv } from '../env'

// Reloj del servidor. Los relojes de dos móviles pueden no coincidir: si el de B va 40 s
// atrasado respecto al de A, un cambio de B quedaría 40 s antes de lo que fue. Por eso cada
// móvil mide la diferencia con la hora del servidor (public.server_time) y la aplica.
//
//   · `offsetMs` (en vivo): la última medida válida. Se usa para las horas de edición de los
//     datos editables y para pintar el partido que controla otro dispositivo.
//   · Eventos del partido: se usa la corrección CONGELADA para cada periodo de control (ver
//     matchClockOffset): nunca cambia a mitad de partido, así el cronómetro no salta.
// El servidor sigue siendo la autoridad final: valida la coherencia temporal de cada evento.

/** Las diferencias menores no se aplican: evitan que el reloj "baile" con el ruido de la red. */
export const MIN_OFFSET_CHANGE_MS = 500
/** Una medida con una ida y vuelta más lenta no es fiable. */
export const MAX_ROUND_TRIP_MS = 5_000
const META_KEY = 'serverClockOffsetMs'

export class ServerClock {
  private offset = 0
  private readonly deviceNow: () => EpochMs

  constructor(deviceNow: () => EpochMs = () => Date.now()) {
    this.deviceNow = deviceNow
  }

  get offsetMs(): number {
    return this.offset
  }

  /** Hora estimada del servidor. */
  now(): EpochMs {
    return this.deviceNow() + this.offset
  }

  /** Entorno de datos con la hora corregida. */
  env(newId: () => Id): DataEnv {
    return { now: () => this.now(), newId, clockOffsetMs: () => this.offset }
  }

  /** Última corrección conocida (para arrancar sin conexión con la misma referencia). */
  async load(db: AppDatabase): Promise<void> {
    const stored = (await db.meta.get(META_KEY))?.value
    if (typeof stored === 'number' && Number.isFinite(stored)) this.offset = stored
  }

  /**
   * Mide la diferencia con el servidor: servidor − punto medio de la ida y vuelta. Devuelve la
   * medida exacta (null si no es fiable). La corrección en vivo solo cambia si la diferencia
   * con la anterior es apreciable.
   */
  async measure(serverTime: () => Promise<EpochMs>, db?: AppDatabase): Promise<number | null> {
    const sent = this.deviceNow()
    const server = await serverTime()
    const received = this.deviceNow()
    if (!Number.isFinite(server) || received - sent > MAX_ROUND_TRIP_MS || received < sent) return null
    const measured = Math.round(server - (sent + received) / 2)
    if (Math.abs(measured - this.offset) >= MIN_OFFSET_CHANGE_MS) {
      this.offset = measured
      if (db) await db.meta.put({ key: META_KEY, value: measured })
    }
    return measured
  }
}

/** Último SETUP_STARTED / CONTROL_TAKEN: el que inició el periodo de control actual. */
export function lastControlEvent(events: readonly MatchEvent[]): MatchEvent | undefined {
  let last: MatchEvent | undefined
  for (const event of events) {
    if ((event.type === 'SETUP_STARTED' || event.type === 'CONTROL_TAKEN') && (!last || event.seq > last.seq)) last = event
  }
  return last
}

/**
 * Corrección de reloj para los eventos de un partido:
 *   · antes de PLAY, la corrección en vivo (aún no hay tiempo de partido que proteger);
 *   · desde PLAY, la que quedó congelada para el periodo de control actual;
 *   · si el periodo de control cambió (otro SETUP_STARTED/CONTROL_TAKEN), la en vivo, que
 *     queda congelada para ese nuevo periodo.
 */
export function matchClockOffset(
  match: Pick<MatchRecord, 'clockOffset'>,
  events: readonly MatchEvent[],
  liveOffsetMs: number,
): { readonly ms: number; readonly controlEventId: Id | null } {
  const control = lastControlEvent(events)
  const started = events.some((e) => e.type === 'MATCH_STARTED')
  if (started && control && match.clockOffset?.controlEventId === control.id) return match.clockOffset
  return { ms: liveOffsetMs, controlEventId: control?.id ?? null }
}
