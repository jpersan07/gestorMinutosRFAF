import Dexie, { type Table } from 'dexie'
import type { EpochMs, Half, Id, Lineup, MatchEvent, MatchStatus } from '../domain'

// Persistencia local (IndexedDB). Una tabla por entidad, relacionadas por id.
// Todos los registros son JSON plano (sin Date, Map, Blob…): se pueden exportar o
// sincronizar tal cual, y añadir campos opcionales nunca rompe los datos existentes.

/** Estado de sincronización con el servidor (Fase 3). En la Fase 2 todo queda 'pending'. */
export type SyncState = 'pending' | 'synced'

interface Tracked {
  readonly createdAt: EpochMs
  readonly updatedAt: EpochMs
  readonly syncState: SyncState
}

export interface TeamRecord extends Tracked {
  readonly id: Id
  readonly name: string
}

export interface SeasonRecord extends Tracked {
  readonly id: Id
  readonly teamId: Id
  /** '2026-27' */
  readonly name: string
}

export interface CoachRecord extends Tracked {
  readonly id: Id
  readonly teamId: Id
  readonly name: string
  readonly active: boolean
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
}

export interface MatchSquadRecord {
  readonly matchId: Id
  readonly playerIds: readonly Id[]
  readonly updatedAt: EpochMs
  readonly updatedBy: Id | null
  readonly syncState: SyncState
}

export type StoredEvent = MatchEvent & { readonly syncState: SyncState }

/** Borrador del editor de alineación. Solo local: no se sincroniza. */
export interface LineupDraftRecord {
  readonly matchId: Id
  readonly half: Half
  readonly lineup: Lineup
  readonly updatedAt: EpochMs
}

export interface MatchReportRecord {
  readonly matchId: Id
  /** Texto libre, p. ej. "3-1". Obligatorio para guardar el partido. */
  readonly result: string
  readonly observations: string
  readonly updatedAt: EpochMs
  readonly updatedBy: Id | null
  readonly syncState: SyncState
}

/** Proyección para estadísticas: se recalcula desde los eventos al finalizar y al guardar. */
export interface PlayerMatchMinutesRecord {
  readonly matchId: Id
  readonly playerId: Id
  readonly secondsPlayed: number
  readonly minutesPlayed: number
  readonly started: boolean
  readonly syncState: SyncState
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
  declare coaches: Table<CoachRecord, Id>
  declare players: Table<PlayerRecord, Id>
  declare matches: Table<MatchRecord, Id>
  declare matchSquads: Table<MatchSquadRecord, Id>
  declare matchEvents: Table<StoredEvent, Id>
  declare lineupDrafts: Table<LineupDraftRecord, [Id, Half]>
  declare matchReports: Table<MatchReportRecord, Id>
  declare playerMatchMinutes: Table<PlayerMatchMinutesRecord, [Id, Id]>
  declare crests: Table<CrestRecord, Id>
  declare errorLog: Table<ErrorLogRecord, number>

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
  }
}
