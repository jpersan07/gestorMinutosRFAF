-- =============================================================================
-- Gestor de Minutos · 5 · Descarga y TOMAR CONTROL entre dispositivos (bloque 3d)
--
--   · Garantía en la base de datos de que el historial de un partido NO tiene huecos:
--     un evento con seq = n solo puede existir si ya existe seq = n − 1. Los móviles
--     descargan "seq > último local" y así nunca se pierde un evento.
--   · TOMAR CONTROL atómico: public.take_match_control() toma el control SOLO si el
--     control_epoch que el móvil descargó sigue siendo el actual (comparar-y-cambiar
--     bajo el bloqueo de la fila del partido). append_match_events() ya no acepta
--     CONTROL_TAKEN: no hay otra forma de tomar el control.
--   · public.server_time(): hora del servidor para que los móviles corrijan su reloj.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Historial sin huecos
-- -----------------------------------------------------------------------------

-- Con unique (match_id, seq), eventos inmutables (ni UPDATE ni DELETE ni TRUNCATE) y esta
-- comprobación, por inducción el historial de cada partido es siempre 1, 2, …, last_seq.
-- Si dos transacciones intentan insertar n y n + 1 a la vez, la de n + 1 no ve n (aún sin
-- confirmar) y falla: nunca puede quedar confirmado n + 1 sin n. Vale también para inserciones
-- directas con la clave de servicio, no solo para las que pasan por append_match_events().
create function private.enforce_contiguous_seq()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seq > 1 and not exists (
    select 1 from public.match_events e where e.match_id = new.match_id and e.seq = new.seq - 1
  ) then
    raise exception 'SEQ_GAP' using errcode = 'P0001',
      detail = format('Falta el evento %s del partido: no se puede guardar el %s.', new.seq - 1, new.seq);
  end if;
  return new;
end;
$$;

create trigger a_contiguous_seq before insert on public.match_events
  for each row execute function private.enforce_contiguous_seq();

-- -----------------------------------------------------------------------------
-- append_match_events: ya no admite CONTROL_TAKEN
-- -----------------------------------------------------------------------------

-- La validación completa (3a) pasa a ser interna. Solo la llaman append_match_events() y
-- take_match_control(); los móviles no pueden ejecutarla directamente.
alter function public.append_match_events(uuid, jsonb) set schema private;
alter function private.append_match_events(uuid, jsonb) rename to append_match_events_unchecked;
revoke all on function private.append_match_events_unchecked(uuid, jsonb) from public, anon, authenticated;

-- Misma firma y misma respuesta que antes. Si el lote trae un CONTROL_TAKEN nuevo, se procesan
-- los eventos anteriores y ese se rechaza con TAKE_CONTROL_REQUIRED (lo posterior no se procesa).
-- Un CONTROL_TAKEN ya guardado (reintento) sigue siendo un duplicado idempotente.
create function public.append_match_events(p_match_id uuid, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_take jsonb;
  v_take_seq integer;
  v_result jsonb;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    return private.append_match_events_unchecked(p_match_id, p_events);
  end if;

  select e.value into v_take
  from jsonb_array_elements(p_events) as e
  where e.value ->> 'type' = 'CONTROL_TAKEN'
    and not exists (select 1 from public.match_events me where me.id::text = e.value ->> 'id')
  order by case when (e.value ->> 'seq') ~ '^[0-9]{1,9}$' then (e.value ->> 'seq')::integer end nulls last
  limit 1;

  if v_take is null then
    return private.append_match_events_unchecked(p_match_id, p_events);
  end if;

  v_take_seq := case when (v_take ->> 'seq') ~ '^[0-9]{1,9}$' then (v_take ->> 'seq')::integer end;
  v_result := private.append_match_events_unchecked(p_match_id, coalesce((
    select jsonb_agg(e.value)
    from jsonb_array_elements(p_events) as e
    where v_take_seq is not null
      and (e.value ->> 'seq') ~ '^[0-9]{1,9}$'
      and (e.value ->> 'seq')::integer < v_take_seq
  ), '[]'::jsonb));

  if jsonb_typeof(v_result -> 'rejected') = 'object' then
    return v_result;
  end if;
  return jsonb_set(
    v_result,
    '{rejected}',
    jsonb_build_object('id', v_take ->> 'id', 'seq', v_take_seq, 'reason', 'TAKE_CONTROL_REQUIRED')
  );
end;
$$;

revoke all on function public.append_match_events(uuid, jsonb) from public, anon;
grant execute on function public.append_match_events(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- take_match_control: TOMAR CONTROL como operación atómica
-- -----------------------------------------------------------------------------

-- "Toma el control si el control que he descargado (p_expected_control_epoch) sigue siendo el
-- actual". Todo ocurre bajo el bloqueo FOR UPDATE de la fila del partido:
--   · si otro dispositivo tomó el control entre medias → CONTROL_CHANGED (no se escribe nada);
--   · si el controlador registró más eventos entre medias → SEQ_CONFLICT (el móvil descarga y
--     puede reintentar con el mismo control_epoch);
--   · si no, el CONTROL_TAKEN pasa por la validación completa (pertenencia al equipo,
--     partido no guardado ni sin preparar, seq = último + 1…) y se guarda.
-- Dos TOMAR CONTROL simultáneos con el mismo epoch: el segundo espera al bloqueo, ve el epoch
-- ya cambiado y recibe CONTROL_CHANGED. Nunca decide la hora ni el orden de llegada.
create function public.take_match_control(p_match_id uuid, p_expected_control_epoch integer, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_match public.matches%rowtype;
  v_event_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_event) is distinct from 'object'
     or p_event ->> 'type' is distinct from 'CONTROL_TAKEN'
     or p_expected_control_epoch is null then
    raise exception 'INVALID_PAYLOAD' using errcode = '22023';
  end if;
  begin
    v_event_id := (p_event ->> 'id')::uuid;
  exception when others then
    raise exception 'INVALID_PAYLOAD' using errcode = '22023';
  end;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found or not private.is_team_member(v_match.team_id) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Reintento de una toma ya aceptada: la validación lo devuelve como duplicado.
  if not exists (select 1 from public.match_events where id = v_event_id)
     and v_match.control_epoch is distinct from p_expected_control_epoch then
    return jsonb_build_object(
      'accepted', '[]'::jsonb,
      'duplicates', '[]'::jsonb,
      'rejected', jsonb_build_object(
        'id', v_event_id,
        'seq', case when (p_event ->> 'seq') ~ '^[0-9]{1,9}$' then (p_event ->> 'seq')::integer end,
        'reason', 'CONTROL_CHANGED'
      ),
      'match', jsonb_build_object(
        'status', v_match.status,
        'last_seq', v_match.last_seq,
        'controller_device_id', v_match.controller_device_id,
        'control_epoch', v_match.control_epoch
      )
    );
  end if;

  return private.append_match_events_unchecked(p_match_id, jsonb_build_array(p_event));
end;
$$;

revoke all on function public.take_match_control(uuid, integer, jsonb) from public, anon;
grant execute on function public.take_match_control(uuid, integer, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Hora del servidor (ms desde 1970) para corregir el reloj de los móviles
-- -----------------------------------------------------------------------------

create function public.server_time()
returns bigint
language sql
volatile
set search_path = ''
as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

revoke all on function public.server_time() from public, anon;
grant execute on function public.server_time() to authenticated;
