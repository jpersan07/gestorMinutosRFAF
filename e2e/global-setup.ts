import { serverAdmin } from './admin.ts'

/**
 * Los E2E simulan minutos de partido ADELANTANDO el reloj del navegador (page.clock): para el
 * servidor, esos eventos están "en el futuro" (EVENT_IN_FUTURE, 3e.1). Solo en el Supabase LOCAL y
 * solo mientras duran los E2E, se amplía la tolerancia; global-teardown la restaura (60 s).
 * La protección se prueba con la tolerancia real en `npm run test:db` (timestamps.test.ts).
 */
export default async function globalSetup() {
  const { error } = await serverAdmin.rpc('set_event_time_policy', { p_max_future_ms: 24 * 3600_000 })
  if (error) throw error
}
