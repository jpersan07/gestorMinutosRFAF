import type { TeamRecord } from '../db'

// MODO PRUEBAS: solo para el equipo llamado exactamente "DEMO" (datos del servidor).

/** Nombre del único equipo con modo pruebas. */
export const TEST_TEAM_NAME = 'DEMO'

/**
 * En modo pruebas el partido se fecha HACIA ATRÁS al pulsar PLAY: empieza "hace" 3 horas. Así los
 * botones pueden adelantar el reloj del partido (hasta 3 h en total) sin que ningún evento quede
 * nunca en el futuro respecto a la hora del servidor (EVENT_IN_FUTURE): se sincroniza como
 * cualquier otro partido. 3 h cubren un partido completo (2 × 45 min + descanso) con margen.
 */
export const TEST_CLOCK_BUDGET_MS = 3 * 3600_000

/** El equipo (tal como lo descargó el servidor) es el de pruebas. */
export function isTestTeam(team: Pick<TeamRecord, 'name'> | null | undefined): boolean {
  return team?.name === TEST_TEAM_NAME
}
