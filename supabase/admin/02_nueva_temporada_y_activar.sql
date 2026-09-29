-- =============================================================================
-- 02 · Crear una TEMPORADA nueva para un equipo y dejarla como ACTIVA (p. ej. en verano)
--
-- Dónde: panel de Supabase → SQL Editor. Sustituye los valores entre < >.
-- El id del equipo se ve con 07_consultar_equipos_y_temporadas.sql.
-- Las temporadas anteriores NO se borran: sus partidos y minutos se conservan.
-- Los móviles pasan a la temporada nueva la próxima vez que abren la app con conexión.
-- Si la temporada ya existe, solo se activa.
-- =============================================================================
do $$
declare
  -- DATOS ---------------------------------------------------------------------
  v_team_id_text text := '<ID_DEL_EQUIPO>';
  v_season_name  text := '<TEMPORADA_AAAA-AA>';       -- formato 2027-28
  -- ---------------------------------------------------------------------------
  v_team_id uuid;
  v_season_id uuid;
begin
  if v_team_id_text like '%<%' or v_season_name like '%<%' then
    raise exception 'Sustituye los valores entre < > antes de ejecutar.';
  end if;
  v_team_id := v_team_id_text::uuid;
  if not exists (select 1 from public.teams where id = v_team_id) then
    raise exception 'No existe ningún equipo con id %.', v_team_id;
  end if;

  select id into v_season_id from public.seasons where team_id = v_team_id and name = btrim(v_season_name);
  if v_season_id is null then
    insert into public.seasons (team_id, name) values (v_team_id, btrim(v_season_name)) returning id into v_season_id;
    raise notice 'Temporada creada: %', v_season_name;
  else
    raise notice 'La temporada % ya existía: solo se activa.', v_season_name;
  end if;
  update public.teams set current_season_id = v_season_id, updated_at = now() where id = v_team_id;
  raise notice 'Temporada activa del equipo: % (id %)', v_season_name, v_season_id;
end;
$$;
