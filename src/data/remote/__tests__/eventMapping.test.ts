import { describe, expect, it } from 'vitest'
import { replay } from '../../../domain'
import { MatchHarness } from '../../../domain/__tests__/harness'
import { fromRemoteEvent, toRemoteEvent, type RemoteEventRow } from '../eventMapping'

/** Lo que devolvería la API tras guardar el evento (timestamps en ISO, JSON puro). */
function asServerRow(event: ReturnType<typeof toRemoteEvent>, matchId: string, userId: string): RemoteEventRow {
  const remote = JSON.parse(JSON.stringify(event)) as ReturnType<typeof toRemoteEvent>
  return {
    id: remote.id,
    match_id: matchId,
    seq: remote.seq,
    event_type: remote.type,
    occurred_at: new Date(remote.occurred_at).toISOString().replace('Z', '+00:00'),
    device_id: remote.device_id,
    user_id: userId,
    half: remote.half,
    match_second: remote.match_second,
    player_id: remote.player_id,
    related_player_id: remote.related_player_id,
    substitution_id: remote.substitution_id,
    slot_id: remote.slot_id,
    payload: remote.payload,
  }
}

describe('conversión de eventos dominio ↔ servidor', () => {
  it('ida y vuelta de todos los tipos de evento conserva el partido', () => {
    const h = new MatchHarness()
    h.kickOff()
    h.sub('p10', 'p12', '20:13')
    h.must({ type: 'UNDO_LAST_SUBSTITUTION' })
    h.sub('p10', 'p13', '30:07')
    h.must({ type: 'TAKE_CONTROL' }, { deviceId: 'device-B' })
    h.deviceId = 'device-B'
    h.toHalftime()
    h.secondHalf()
    h.sub('p13', 'p10', '70:00')
    h.toFullTime()
    h.must({ type: 'SAVE_MATCH' })

    const types = new Set(h.events.map((e) => e.type))
    expect(types.size).toBe(11)

    const back = h.events.map((e) => fromRemoteEvent(asServerRow(toRemoteEvent(e), h.matchId, h.coachId)))
    expect(back).toEqual(h.events)
    expect(replay(h.matchId, back)).toEqual(h.state)
  })

  it('una fila incompleta del servidor se detecta en lugar de producir un evento inválido', () => {
    const h = new MatchHarness()
    h.kickOff()
    const [out] = h.sub('p10', 'p12', '10:00')
    const row = { ...asServerRow(toRemoteEvent(out!), h.matchId, h.coachId), slot_id: null }
    expect(() => fromRemoteEvent(row)).toThrow(/slot_id/)
  })
})
