import Dexie, { type Table } from 'dexie'
import type { EpochMs, Half, Id, Lineup, MatchEvent, MatchStatus } from '../domain'

// Persistencia local (IndexedDB). Una tabla por entidad, relacionadas por id.
// Todos los registros son JSON plano (sin Date, Map, Blob…): se pueden exportar o
// sincronizar tal cual, y añadir campos opcionales nunca rompe los datos existentes.

/**
 * Estado de sincronización con el servidor:
 *   · pending  → falta subirlo;
 *   · synced   → el servidor lo tiene;
 *   · conflict → el servidor lo ha rechazado (ver `syncIssue`); no se reintenta hasta que el
 *                entrenador lo cambie. Nunca se resuelve automáticamente (C-1, C-2).
 * Los eventos del partido nunca quedan en 'conflict': los rechazados van a cuarentena.
 */
export type SyncState = 'pending' | 'synced' | 'conflict'

/** Motivo por el que el servidor rechazó un dato editable. */
export type SyncIssue =
  /** Otro jugador activo del equipo ya tiene ese dorsal en el servidor (C-1). */
  | 'NUMBER_TAKEN'
  /** El partido ya ha empezado (u otro móvil lo ha empezado): datos/convocatoria bloqueados (C-2). */
  | 'MATCH_LOCKED'

interface SyncTracked {
  readonly syncState: SyncState
  readonly syncIssue?: SyncIssue | null
}

interface Tracked extends SyncTracked {
  readonly createdAt: EpochMs
  readonly updatedAt: EpochMs
}

// ---- Datos del servidor (solo lectura en el móvil) ----

export interface TeamRecord {
  readonly id: Id
  readonly name: string
  readonly currentSeasonId: Id | null
  readonly updatedAt: EpochMs
}

export interface SeasonRecord {
  readonly id: Id
  readonly teamId: Id
  /** '2026-27' */
  readonly name: string
  readonly updatedAt: EpochMs
}

/** Perfil de una cuenta de entrenador (Supabase Auth). El id es el del usuario. */
export interface ProfileRecord {
  readonly id: Id
  readonly displayName: string
  readonly updatedAt: EpochMs
}

export type TeamRole = 'admin' | 'coach'

export interface TeamMemberRecord {
  readonly teamId: Id
  readonly userId: Id
  readonly role: TeamRole
}

/** Jugador del equipo. `active` = en la plantilla actual (las bajas no se borran: tienen historial). */
export interface PlayerRecord extends Tracked {
  readonly id: Id
  readonly teamId: Id
  readonly name: string
  readonly number: number
  readonly active: boolean
}

export interface MatchRecord extends Tracked {
  readonly id: Id
  readonly teamId: Id
  readonly seasonId: Id
  readonly opponent: string
  readonly crestId: Id | null
  /** Fecha local 'YYYY-MM-DD' (opcional hasta que se conozca). */
  readonly matchDate: string | null
  /** Hora local 'HH:MM'. */
  readonly kickoffTime: string | null
  readonly location: string | null
  /** Caché del estado derivado de los eventos (se actualiza en la misma transacción). */
  readonly status: MatchStatus
  readonly managedBy: Id | null
  readonly controllerDeviceId: string | null
  readonly savedAt: EpochMs | null
  /**
   * Última edición de rival/escudo/fecha/hora/ubicación. Es la hora que decide "gana el último"
   * en el servidor para estos datos (updatedAt cambia con cada evento del partido y no sirve).
   */
  readonly detailsUpdatedAt?: EpochMs
  /** El servidor rechazó eventos porque otro dispositivo tomó el control (3c). */
  readonly controlLostAt?: EpochMs | null
  readonly controlLossReason?: string | null
}

export interface MatchSquadRecord extends SyncTracked {
  readonly matchId: Id
  readonly playerIds: readonly Id[]
  readonly updatedAt: EpochMs
  readonly updatedBy: Id | null
}

export type StoredEvent = MatchEvent & { readonly syncState: 'pending' | 'synced' }

/**
 * Cuarentena: eventos que el servidor rechazó (y los pendientes posteriores del mismo partido).
 * Están FUERA de matchEvents, así que nunca cuentan para estado, minutos ni resumen. No se borran:
 * sirven para explicar al entrenador qué no se aplicó y para depurar.
 */
export interface RejectedEventRecord {
  readonly id: Id
  readonly matchId: Id
  readonly seq: number
  readonly event: MatchEvent
  /** Motivo del servidor (SEQ_CONFLICT, NOT_CONTROLLER, INVALID_MATCH_SECOND…). */
  readonly reason: string
  /** Evento que el servidor rechazó (los demás se apartan porque dependen de él). */
  readonly rejectedEventId: Id
  readonly quarantinedAt: EpochMs
}

/** Borrador del editor de alineación. Solo local: no se sincroniza. */
export interface LineupDraftRecord {
  readonly matchId: Id
  readonly half: Half
  readonly lineup: Lineup
  readonly updatedAt: EpochMs
}

export interface MatchReportRecord extends SyncTracked {
  readonly matchId: Id
  /** Texto libre, p. ej. "3-1". Obligatorio para guardar el partido. */
  readonly result: string
  readonly observations: string
  readonly updatedAt: EpochMs
  readonly updatedBy: Id | null
}

/** Proyección para estadísticas: se recalcula desde los eventos al finalizar y al guardar. */
export interface PlayerMatchMinutesRecord extends SyncTracked {
  readonly matchId: Id
  readonly playerId: Id
  readonly secondsPlayed: number
  readonly minutesPlayed: number
  readonly started: boolean
}

/** Escudo como data URL (imagen ya redimensionada): serializable a JSON. */
export interface CrestRecord extends Tracked {
  readonly id: Id
  readonly dataUrl: string
}

export interface MetaRecord {
  readonly key: string
  readonly value: unknown
}

export interface ErrorLogRecord {
  readonly id?: number
  readonly createdAt: EpochMs
  readonly message: string
  readonly context: unknown
}

export class AppDatabase extends Dexie {
  declare meta: Table<MetaRecord, string>
  declare teams: Table<TeamRecord, Id>
  declare seasons: Table<SeasonRecord, Id>
  declare profiles: Table<ProfileRecord, Id>
  declare teamMembers: Table<TeamMemberRecord, [Id, Id]>
  declare players: Table<PlayerRecord, Id>
  declare matches: Table<MatchRecord, Id>
  declare matchSquads: Table<MatchSquadRecord, Id>
  declare matchEvents: Table<StoredEvent, Id>
  declare lineupDrafts: Table<LineupDraftRecord, [Id, Half]>
  declare matchReports: Table<MatchReportRecord, Id>
  declare playerMatchMinutes: Table<PlayerMatchMinutesRecord, [Id, Id]>
  declare crests: Table<CrestRecord, Id>
  declare errorLog: Table<ErrorLogRecord, number>
  declare rejectedEvents: Table<RejectedEventRecord, Id>

  constructor(name = 'gestor-minutos') {
    super(name)
    this.version(1).stores({
      meta: 'key',
      teams: 'id',
      seasons: 'id, teamId',
      coaches: 'id, teamId',
      players: 'id, teamId',
      matches: 'id, teamId, seasonId, status',
      matchSquads: 'matchId',
      // [matchId+seq] único: dos pestañas nunca pueden escribir dos historias distintas.
      matchEvents: 'id, matchId, &[matchId+seq]',
      lineupDrafts: '[matchId+half]',
      matchReports: 'matchId',
      playerMatchMinutes: '[matchId+playerId], matchId, playerId',
      crests: 'id',
      errorLog: '++id, createdAt',
    })
    // v2 (Fase 3b): la identidad viene de Supabase Auth. Los entrenadores locales se sustituyen
    // por perfiles y miembros del equipo descargados del servidor. No se borra ningún dato aquí:
    // el descarte de los datos de prueba lo decide el entrenador al iniciar sesión.
    this.version(2).stores({
      coaches: null,
      profiles: 'id',
      teamMembers: '[teamId+userId], teamId, userId',
    })
    // v3 (Fase 3c): subida al servidor. Índice syncState para leer la cola sin recorrer todo y
    // cuarentena de eventos rechazados. Sin pérdida de datos.
    this.version(3).stores({
      players: 'id, teamId, syncState',
      matches: 'id, teamId, seasonId, status, syncState',
      matchSquads: 'matchId, syncState',
      matchEvents: 'id, matchId, &[matchId+seq], syncState',
      matchReports: 'matchId, syncState',
      playerMatchMinutes: '[matchId+playerId], matchId, playerId, syncState',
      crests: 'id, syncState',
      rejectedEvents: 'id, matchId',
    })
  }
}
