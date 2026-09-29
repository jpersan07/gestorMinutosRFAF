-- =============================================================================
-- 09 · BORRAR un equipo DE PRUEBAS y TODOS sus datos (partidos, eventos, jugadores, temporadas,
--      convocatorias, informes, minutos, escudos y errores técnicos)
--
-- SOLO para el equipo temporal de la puesta en marcha: por seguridad, el nombre del equipo tiene
-- que empezar por "PRUEBAS". Un equipo real no se puede borrar con este script.
--
-- El historial de los partidos es inmutable: para borrarlo, durante esta única operación se
-- desactiva el trigger que lo protege y se vuelve a activar al terminar. Todo ocurre en una sola
-- transacción: si algo falla, no se borra nada y el trigger sigue activo.
--
-- Después, a mano en el panel:
--   · Storage → crests → carpeta con el id del equipo → borrar sus imágenes (si hay);
--   · Authentication → Users → borrar las cuentas de prueba (ya no tienen partidos).
-- Dónde: SQL Editor. Sustituye los valores entre < >.
-- =============================================================================
do $$
declare
  -- DATOS ---------------------------------------------------------------------
  v_team_id_text text := '<ID_DEL_EQUIPO_DE_PRUEBAS>';
  -- ---------------------------------------------------------------------------
  v_team_id uuid;
  v_name text;
  v_matches integer;
  v_events integer;
begin
  if v_team_id_text like '%<%' then
    raise exception 'Sustituye los valores entre < > antes de ejecutar.';
  end if;
  v_team_id := v_team_id_text::uuid;
  select name into v_name from public.teams where id = v_team_id;
  if v_name is null then
    raise exception 'No existe ningún equipo con id %.', v_team_id;
  end if;
  if v_name not ilike 'PRUEBAS%' then
    raise exception 'El equipo "%" no es de pruebas (su nombre no empieza por PRUEBAS): no se borra.', v_name;
  end if;

  select count(*) into v_matches from public.matches where team_id = v_team_id;
  select count(*) into v_events from public.match_events where team_id = v_team_id;

  alter table public.match_events disable trigger match_events_immutable;
  delete from public.teams where id = v_team_id;
  alter table public.match_events enable trigger match_events_immutable;

  raise notice 'Borrado el equipo "%" con % partidos y % eventos.', v_name, v_matches, v_events;
end;
$$;

-- Comprobación: el trigger que protege el historial vuelve a estar activo (debe ser true).
select tgenabled <> 'D' as historial_protegido
from pg_trigger
where tgrelid = 'public.match_events'::regclass and tgname = 'match_events_immutable';
