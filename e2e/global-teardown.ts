import { serverAdmin } from './admin.ts'

/** Restaura la tolerancia de producción para horas futuras (ver global-setup.ts). */
export default async function globalTeardown() {
  const { error } = await serverAdmin.rpc('set_event_time_policy', { p_max_future_ms: null })
  if (error) throw error
}
