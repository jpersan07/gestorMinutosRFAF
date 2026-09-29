import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type Supabase = SupabaseClient<Database>

/** Clave del almacenamiento de la sesión en el dispositivo. */
export const AUTH_STORAGE_KEY = 'gestor-minutos-auth'

/**
 * Cliente de Supabase de la app. Solo con la clave PUBLISHABLE (la seguridad es RLS).
 * La sesión se guarda en el dispositivo y se renueva sola; no se inicia sesión desde la URL
 * (la recuperación de contraseña valida el enlace explícitamente en /restablecer).
 */
export function createSupabase(url: string, publishableKey: string): Supabase {
  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
    },
  })
}
