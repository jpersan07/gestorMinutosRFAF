-- =============================================================================
-- 03 · Consultar las CUENTAS de entrenador (solo lectura)
--
-- Muestra email, nombre visible, si ha entrado alguna vez y a qué equipos pertenece.
-- Las cuentas se crean en: panel → Authentication → Users → Add user (ver la guía).
-- =============================================================================
select
  u.email,
  p.display_name as nombre_visible,
  u.id as usuario_id,
  u.created_at as creada,
  u.last_sign_in_at as ultimo_acceso,
  coalesce(string_agg(t.name || ' (' || tm.role || ')', ', ' order by t.name), '— sin equipo —') as equipos
from auth.users u
left join public.profiles p on p.id = u.id
left join public.team_members tm on tm.user_id = u.id
left join public.teams t on t.id = tm.team_id
group by u.id, u.email, p.display_name, u.created_at, u.last_sign_in_at
order by u.email;
