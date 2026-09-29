import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { AUTH_STORAGE_KEY } from '../../data'
import { readStoredSession } from './session'

const storageWith = (value: unknown) => ({
  getItem: (key: string) => (key === AUTH_STORAGE_KEY && value ? JSON.stringify(value) : null),
})
const stored = storageWith({ user: { id: 'isaac' }, expires_at: 1 })

type GetSession = () => Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }>
const fakeSupabase = (getSession: GetSession) => ({ auth: { getSession } }) as never

describe('lectura de la sesión guardada al arrancar', () => {
  it('sin sesión guardada → none (sin llamar a la red)', async () => {
    let called = false
    const supabase = fakeSupabase(async () => {
      called = true
      return { data: { session: null }, error: null }
    })
    expect(await readStoredSession(supabase, { storage: storageWith(null), online: true })).toEqual({ status: 'none' })
    expect(called).toBe(false)
  })

  it('sin conexión → la sesión guardada vale (unverified), sin esperar a la red', async () => {
    const supabase = fakeSupabase(() => new Promise(() => {}))
    expect(await readStoredSession(supabase, { storage: stored, online: false })).toEqual({
      status: 'unverified',
      userId: 'isaac',
    })
  })

  it('red que no responde (renovación colgada) → no bloquea el arranque', async () => {
    const supabase = fakeSupabase(() => new Promise(() => {}))
    expect(await readStoredSession(supabase, { storage: stored, online: true, timeoutMs: 20 })).toEqual({
      status: 'unverified',
      userId: 'isaac',
    })
  })

  it('error de red al renovar → unverified', async () => {
    const supabase = fakeSupabase(async () => ({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    }))
    expect(await readStoredSession(supabase, { storage: stored, online: true })).toEqual({ status: 'unverified', userId: 'isaac' })
  })

  it('sesión válida → valid', async () => {
    const supabase = fakeSupabase(async () => ({ data: { session: { user: { id: 'isaac' } } }, error: null }))
    expect(await readStoredSession(supabase, { storage: stored, online: true })).toEqual({ status: 'valid', userId: 'isaac' })
  })

  it('sesión revocada (error del servidor) → none', async () => {
    const supabase = fakeSupabase(async () => ({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    }))
    expect(await readStoredSession(supabase, { storage: stored, online: true })).toEqual({ status: 'none' })
  })
})
