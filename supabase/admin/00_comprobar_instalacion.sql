-- =============================================================================
-- 00 · COMPROBAR la instalación (solo lectura). Ejecutar justo después de `supabase db push`.
--
-- Cada fila es una comprobación: la columna `ok` debe ser true en TODAS.
-- En un proyecto recién creado, además, no debe haber ningún dato (ni DEMO ni de nadie).
-- =============================================================================
with checks(comprobacion, ok, detalle) as (
  -- Seguridad: RLS activo en TODAS las tablas de la API y en las internas.
  select 'RLS activo en todas las tablas de public',
         bool_and(c.relrowsecurity),
         coalesce(string_agg(c.relname, ', ') filter (where not c.relrowsecurity), 'todas')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'RLS activo en las tablas internas (private)',
         bool_and(c.relrowsecurity),
         coalesce(string_agg(c.relname, ', ') filter (where not c.relrowsecurity), 'todas')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relkind = 'r'
  -- Funciones críticas: existen y solo las puede usar quien debe.
  union all
  select 'append_match_events: solo usuarios con sesión',
         has_function_privilege('authenticated', 'public.append_match_events(uuid, jsonb)', 'execute')
           and not has_function_privilege('anon', 'public.append_match_events(uuid, jsonb)', 'execute'), ''
  union all
  select 'take_match_control: solo usuarios con sesión',
         has_function_privilege('authenticated', 'public.take_match_control(uuid, integer, jsonb)', 'execute')
           and not has_function_privilege('anon', 'public.take_match_control(uuid, integer, jsonb)', 'execute'), ''
  union all
  select 'server_time: solo usuarios con sesión',
         has_function_privilege('authenticated', 'public.server_time()', 'execute')
           and not has_function_privilege('anon', 'public.server_time()', 'execute'), ''
  union all
  select 'set_event_time_policy: solo la clave de servicio',
         not has_function_privilege('authenticated', 'public.set_event_time_policy(integer)', 'execute')
           and not has_function_privilege('anon', 'public.set_event_time_policy(integer)', 'execute'), ''
  union all
  select 'La validación interna de eventos no es accesible desde la API',
         not has_function_privilege('authenticated', 'private.append_match_events_unchecked(uuid, jsonb)', 'execute'), ''
  union all
  select 'Historial de eventos inmutable (triggers)',
         (select count(*) from pg_trigger where tgrelid = 'public.match_events'::regclass
            and tgname in ('match_events_immutable', 'match_events_no_truncate', 'a_contiguous_seq', 'b_not_in_future') and tgenabled <> 'D') = 4, ''
  union all
  select 'Tolerancia de horas futuras de producción (60 s)',
         (select max_future_ms from private.event_time_policy) = 60000,
         (select max_future_ms::text from private.event_time_policy)
  union all
  select 'Bucket de escudos privado',
         exists (select 1 from storage.buckets where id = 'crests' and not public), ''
  -- Producción empieza VACÍA: ni datos DEMO ni de nadie (solo tiene sentido justo tras instalar).
  union all
  select 'Sin equipos (instalación vacía)', (select count(*) from public.teams) = 0, (select count(*)::text from public.teams)
  union all
  select 'Sin cuentas (instalación vacía)', (select count(*) from auth.users) = 0, (select count(*)::text from auth.users)
  union all
  select 'Ningún dato DEMO', not exists (
    select 1 from public.teams where name ilike '%demo%'
    union all
    select 1 from auth.users where email ilike '%@demo.local'
  ), ''
)
select comprobacion, ok, detalle from checks;
