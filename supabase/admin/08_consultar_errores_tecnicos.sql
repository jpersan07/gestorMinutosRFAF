-- =============================================================================
-- 08 · Consultar los ERRORES TÉCNICOS que envían los móviles (solo lectura)
--
-- La app nunca enseña errores técnicos al entrenador: los guarda y los sube aquí.
-- Útil si alguien dice "no sincroniza" o "algo raro ha pasado".
-- =============================================================================
select
  l.created_at as cuando,
  t.name as equipo,
  p.display_name as entrenador,
  l.device_id as dispositivo,
  l.level as nivel,
  l.message as mensaje,
  l.context as contexto
from public.client_logs l
left join public.teams t on t.id = l.team_id
left join public.profiles p on p.id = l.user_id
order by l.created_at desc
limit 100;
