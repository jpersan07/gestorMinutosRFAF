-- =============================================================================
-- 01 · Crear un EQUIPO con su primera TEMPORADA (que queda como temporada activa)
--
-- Dónde: panel de Supabase → SQL Editor (proyecto de PRODUCCIÓN). Pega TODO el fichero.
-- Antes de ejecutar, sustituye los valores entre < > de la sección "DATOS". Si queda alguno
-- sin sustituir, el script se detiene sin cambiar nada.
-- Resultado: muestra el id del equipo y de la temporada (guárdalos para los siguientes pasos).
-- =============================================================================
do $$
declare
  -- DATOS ---------------------------------------------------------------------
  v_team_name   text := '<NOMBRE_DEL_EQUIPO>';        -- p. ej. 'CD Ejemplo Alevín A'
  v_season_name text := '<TEMPORADA_AAAA-AA>';        -- formato 2026-27
  -- ---------------------------------------------------------------------------
  v_team_id uuid;
  v_season_id uuid;
begin
  if v_team_name like '%<%' or v_season_name like '%<%' then
    raise exception 'Sustituye los valores entre < > antes de ejecutar.';
  end if;
  if exists (select 1 from public.teams where lower(btrim(name)) = lower(btrim(v_team_name))) then
    raise exception 'Ya existe un equipo llamado "%". Consulta 07_consultar_equipos_y_temporadas.sql.', v_team_name;
  end if;

  insert into public.teams (name) values (btrim(v_team_name)) returning id into v_team_id;
  insert into public.seasons (team_id, name) values (v_team_id, btrim(v_season_name)) returning id into v_season_id;
  update public.teams set current_season_id = v_season_id, updated_at = now() where id = v_team_id;

  raise notice 'Equipo creado: % (id %)', v_team_name, v_team_id;
  raise notice 'Temporada activa: % (id %)', v_season_name, v_season_id;
end;
$$;

select t.id as equipo_id, t.name as equipo, s.id as temporada_id, s.name as temporada_activa
from public.teams t
join public.seasons s on s.id = t.current_season_id
order by t.created_at desc
limit 5;
