-- =============================================================================
-- 07 · Consultar EQUIPOS y TEMPORADAS (solo lectura)
-- =============================================================================
select
  t.name as equipo,
  t.id as equipo_id,
  s.name as temporada,
  s.id as temporada_id,
  (s.id = t.current_season_id) as activa,
  (select count(*) from public.matches m where m.season_id = s.id) as partidos,
  (select count(*) from public.team_members tm where tm.team_id = t.id) as miembros
from public.teams t
left join public.seasons s on s.team_id = t.id
order by t.name, s.name desc;
