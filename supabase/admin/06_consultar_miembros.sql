-- =============================================================================
-- 06 · Consultar los MIEMBROS de cada equipo (solo lectura)
-- =============================================================================
select
  t.name as equipo,
  t.id as equipo_id,
  p.display_name as nombre_visible,
  u.email,
  tm.role as rol,
  tm.created_at as miembro_desde,
  u.last_sign_in_at as ultimo_acceso
from public.team_members tm
join public.teams t on t.id = tm.team_id
join public.profiles p on p.id = tm.user_id
join auth.users u on u.id = tm.user_id
order by t.name, tm.role, p.display_name;
