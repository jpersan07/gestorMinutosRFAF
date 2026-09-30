import { replay, type EpochMs, type Id } from '../../domain'
import type { Supabase } from '../remote/client'
import { fromRemoteEvent, type RemoteEventInput, type RemoteEventRow } from '../remote/eventMapping'
import type { AppendResult, EditableTable, ServerRow, SyncRemote } from '../remote/syncRemote'
import { T0 } from './testDb'

// Servidor SIMULADO para las pruebas unitarias de descarga, subida y TOMAR CONTROL. Reproduce lo
// que importa del servidor real: cursores synced_at con la hora del SERVIDOR, "gana el último" en
// los datos editables, eventos solo añadidos con seq = último + 1, control único, TOMAR CONTROL
// atómico por control_epoch, MATCH_SAVED exige el RESULTADO y, con el partido guardado, el
// informe y los minutos ya no cambian. (La validación completa se prueba contra Supabase local.)

type Row = Record<string, unknown> & { synced_at: string }

const KEYS: Record<EditableTable, readonly string[]> = {
  players: ['id'],
  matches: ['id'],
  match_squads: ['match_id'],
  match_reports: ['match_id'],
  player_match_minutes: ['match_id', 'player_id'],
}

const NETWORK_ERROR = () => new TypeError('Failed to fetch')

export class FakeServer {
  /** Hora del servidor (independiente del reloj de cada móvil). */
  time = T0
  /** Sin conexión: todas las llamadas fallan como fetch. */
  offline = false
  /** La respuesta de TOMAR CONTROL se pierde (el servidor sí la procesa). */
  loseTakeControlResponse = false
  /** Se llama justo antes de procesar un TOMAR CONTROL (para simular otro móvil escribiendo). */
  beforeTakeControl: (() => Promise<void> | void) | null = null
  /** Los N siguientes TOMAR CONTROL esperan a estar todos antes de procesarse (simultáneos). */
  private barrier: { size: number; waiting: Array<() => void> } | null = null
  readonly calls: Array<{ readonly table: string; readonly since: string | null }> = []
  /** Peticiones de la SUBIDA, en orden: "upsert:<tabla>" o "rpc:<tipos de evento>". */
  readonly requests: string[] = []
  /**
   * Se llama antes ('before') y después ('after') de procesar cada petición de la subida. Poner
   * `offline = true` en 'before' simula un corte de red antes de enviarla; en 'after', que el
   * servidor la procesó pero la respuesta se perdió.
   */
  onRequest: ((request: string, phase: 'before' | 'after') => void) | null = null

  private readonly tables: Record<EditableTable, Map<string, Row>> = {
    players: new Map(),
    matches: new Map(),
    match_squads: new Map(),
    match_reports: new Map(),
    player_match_minutes: new Map(),
  }
  private readonly events = new Map<Id, RemoteEventRow[]>()
  private tick = 0

  readonly teamId: Id

  constructor(teamId: Id) {
    this.teamId = teamId
  }

  /** synced_at: hora del servidor, estrictamente creciente. */
  private stamp(): string {
    return new Date(this.time + ++this.tick).toISOString()
  }

  private check() {
    if (this.offline) throw NETWORK_ERROR()
  }

  simultaneousTakeControls(size: number) {
    this.barrier = { size, waiting: [] }
  }

  row<T extends EditableTable>(table: T, key: string): ServerRow<T> | undefined {
    return this.tables[table].get(key) as ServerRow<T> | undefined
  }

  eventsOf(matchId: Id): RemoteEventRow[] {
    return [...(this.events.get(matchId) ?? [])]
  }

  /** upsert con la regla del servidor: una versión con updated_at anterior se ignora. */
  upsert(table: EditableTable, input: Record<string, unknown>): void {
    const key = KEYS[table].map((k) => String(input[k])).join('|')
    const existing = this.tables[table].get(key)
    if (existing && Date.parse(String(input.updated_at)) < Date.parse(String(existing.updated_at))) return
    const defaults: Record<string, unknown> =
      table === 'matches'
        ? {
            status: 'scheduled',
            controller_device_id: null,
            controller_user_id: null,
            control_epoch: 0,
            last_seq: 0,
            managed_by: null,
            saved_at: null,
            created_by: null,
          }
        : table === 'players'
          ? { active: true, created_by: null }
          : { updated_by: null }
    this.tables[table].set(key, { ...defaults, ...existing, ...input, team_id: this.teamId, synced_at: this.stamp() })
  }

  /** Reglas del servidor para informe y minutos (guard_finished_match_data). */
  private guardFinishedMatchData(table: EditableTable, input: Record<string, unknown>): string | null {
    if (table !== 'match_reports' && table !== 'player_match_minutes') return null
    const status = this.tables.matches.get(String(input.match_id))?.status
    if (status === 'finished') return null
    if (status === 'saved') {
      const existing = this.tables[table].get(KEYS[table].map((k) => String(input[k])).join('|'))
      const fields =
        table === 'match_reports' ? ['result', 'observations'] : ['seconds_played', 'minutes_played', 'started']
      const unchanged = existing !== undefined && fields.every((f) => existing[f] === input[f])
      return unchanged ? null : 'MATCH_LOCKED'
    }
    return 'MATCH_NOT_FINISHED'
  }

  /** append_match_events simplificado (orden, control único, CONTROL_TAKEN solo por TOMAR CONTROL). */
  append(userId: Id, matchId: Id, input: readonly RemoteEventInput[], allowControl = false): AppendResult {
    const match = this.tables.matches.get(matchId)
    if (!match) throw new Error('MATCH_NOT_FOUND')
    const stored = this.events.get(matchId) ?? []
    this.events.set(matchId, stored)
    const accepted: Id[] = []
    const duplicates: Id[] = []
    let rejected: AppendResult['rejected'] = null
    for (const event of [...input].sort((a, b) => a.seq - b.seq)) {
      const reject = (reason: string) => (rejected = { id: event.id, seq: event.seq, reason })
      const same = stored.find((e) => e.id === event.id)
      if (same) {
        if (same.seq === event.seq) {
          duplicates.push(event.id)
          continue
        }
        reject('ID_CONFLICT')
        break
      }
      const last = Number(match.last_seq)
      const controller = [match.controller_device_id, match.controller_user_id]
      if (event.seq <= last) reject('SEQ_CONFLICT')
      else if (event.seq > last + 1) reject('SEQ_GAP')
      else if (event.type === 'CONTROL_TAKEN' && !allowControl) reject('TAKE_CONTROL_REQUIRED')
      else if (
        event.type === 'MATCH_SAVED' &&
        String(this.tables.match_reports.get(matchId)?.result ?? '').trim() === ''
      )
        reject('RESULT_REQUIRED')
      else if (event.type === 'CONTROL_TAKEN' && controller[0] === event.device_id && controller[1] === userId)
        reject('ALREADY_CONTROLLER')
      else if (
        event.type !== 'SETUP_STARTED' &&
        event.type !== 'CONTROL_TAKEN' &&
        (controller[0] !== event.device_id || controller[1] !== userId)
      )
        reject('NOT_CONTROLLER')
      if (rejected) break

      stored.push({
        id: event.id,
        match_id: matchId,
        seq: event.seq,
        event_type: event.type,
        occurred_at: new Date(event.occurred_at).toISOString(),
        device_id: event.device_id,
        user_id: userId,
        half: event.half,
        match_second: event.match_second,
        player_id: event.player_id,
        related_player_id: event.related_player_id,
        substitution_id: event.substitution_id,
        slot_id: event.slot_id,
        payload: event.payload,
      })
      accepted.push(event.id)
      const state = replay(matchId, stored.map(fromRemoteEvent))
      const control = event.type === 'SETUP_STARTED' || event.type === 'CONTROL_TAKEN'
      Object.assign(match, {
        last_seq: event.seq,
        status: state.status,
        controller_device_id: control ? event.device_id : match.controller_device_id,
        controller_user_id: control ? userId : match.controller_user_id,
        managed_by: control ? userId : match.managed_by,
        control_epoch: Number(match.control_epoch) + (control ? 1 : 0),
        synced_at: this.stamp(),
      })
    }
    return {
      accepted,
      duplicates,
      rejected,
      match: {
        status: String(match.status),
        last_seq: Number(match.last_seq),
        controller_device_id: (match.controller_device_id as string | null) ?? null,
        control_epoch: Number(match.control_epoch),
      },
    }
  }

  /** take_match_control: comparar-y-cambiar sobre control_epoch. */
  async takeControl(userId: Id, matchId: Id, epoch: number, event: RemoteEventInput): Promise<AppendResult> {
    this.check()
    if (this.barrier) {
      const barrier = this.barrier
      await new Promise<void>((resolve) => {
        barrier.waiting.push(resolve)
        if (barrier.waiting.length === barrier.size) {
          this.barrier = null
          for (const release of barrier.waiting) release()
        }
      })
    }
    await this.beforeTakeControl?.()
    const match = this.tables.matches.get(matchId)!
    const known = (this.events.get(matchId) ?? []).some((e) => e.id === event.id)
    let result: AppendResult
    if (!known && Number(match.control_epoch) !== epoch) {
      result = {
        accepted: [],
        duplicates: [],
        rejected: { id: event.id, seq: event.seq, reason: 'CONTROL_CHANGED' },
      }
    } else {
      result = this.append(userId, matchId, [event], true)
    }
    if (this.loseTakeControlResponse) throw NETWORK_ERROR()
    return result
  }

  /** Lo que ve la app de un usuario (lecturas de la descarga + TOMAR CONTROL). */
  remote(userId: Id): SyncRemote {
    return {
      teamSnapshot: async (teamId) => {
        this.check()
        return {
          team: { id: teamId, name: 'Equipo de prueba', currentSeasonId: 'season-1' },
          seasons: [{ id: 'season-1', name: '2026-27' }],
          members: [
            { userId: 'user-isaac', displayName: 'ISAAC', role: 'admin' },
            { userId: 'user-jordi', displayName: 'JORDI', role: 'coach' },
          ],
        }
      },
      changedSince: async (table, _teamId, since) => {
        this.check()
        this.calls.push({ table, since })
        return [...this.tables[table].values()]
          .filter((row) => !since || Date.parse(row.synced_at) > Date.parse(since))
          .sort((a, b) => Date.parse(a.synced_at) - Date.parse(b.synced_at)) as never
      },
      match: async (matchId) => {
        this.check()
        return (this.tables.matches.get(matchId) as ServerRow<'matches'> | undefined) ?? null
      },
      matchEventsAfter: async (matchId, afterSeq) => {
        this.check()
        return this.eventsOf(matchId).filter((e) => e.seq > afterSeq)
      },
      matchData: async (matchId) => {
        this.check()
        return {
          squad: (this.tables.match_squads.get(matchId) as ServerRow<'match_squads'> | undefined) ?? null,
          report: (this.tables.match_reports.get(matchId) as ServerRow<'match_reports'> | undefined) ?? null,
          minutes: [...this.tables.player_match_minutes.values()].filter((r) => r.match_id === matchId) as never,
        }
      },
      crests: async () => {
        this.check()
        return []
      },
      crestImage: async () => {
        this.check()
        return new Blob([])
      },
      takeControl: (matchId, epoch, event) => this.takeControl(userId, matchId, epoch, event),
      serverTime: async (): Promise<EpochMs> => {
        this.check()
        return this.time
      },
    }
  }

  /** Lo mínimo de supabase-js que usa la SUBIDA (3c): upserts y append_match_events. */
  supabase(userId: Id): Supabase {
    const offline = { data: null, error: { message: 'TypeError: Failed to fetch' } }
    const request = (name: string, fn: () => { data: unknown; error: { code: string; message: string } | null }) => {
      this.requests.push(name)
      this.onRequest?.(name, 'before')
      if (this.offline) return Promise.resolve(offline)
      const response = fn()
      this.onRequest?.(name, 'after')
      return Promise.resolve(this.offline ? offline : response)
    }
    const result = (fn: () => string | null | void) => {
      const error = fn()
      return { data: null, error: error ? { code: 'P0001', message: error } : null }
    }
    const fake = {
      from: (table: string) => ({
        upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) =>
          request(`upsert:${table}`, () =>
            result(() => {
              if (!(table in KEYS)) return null
              const list = [rows].flat()
              for (const row of list) {
                const error = this.guardFinishedMatchData(table as EditableTable, row)
                if (error) return error
              }
              for (const row of list) this.upsert(table as EditableTable, row)
              return null
            }),
          ),
        insert: () => request(`insert:${table}`, () => result(() => undefined)),
      }),
      rpc: (name: string, args: { p_match_id: Id; p_events: RemoteEventInput[] }) => {
        if (name !== 'append_match_events') throw new Error(name)
        return request(`rpc:${args.p_events.map((e) => e.type).join(',')}`, () => ({
          data: this.append(userId, args.p_match_id, args.p_events),
          error: null,
        }))
      },
      storage: { from: () => ({ upload: () => request('storage:upload', () => result(() => undefined)) }) },
    }
    return fake as unknown as Supabase
  }
}
