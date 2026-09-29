-- =============================================================================
-- Gestor de Minutos · 6 · Eventos con hora futura (bloque 3e.1, D-E9)
--
-- La hora del SERVIDOR es la autoridad: un evento cuya hora (occurred_at) está claramente en el
-- futuro respecto a la hora del servidor al recibirlo no se guarda.
--
-- Tolerancia: 60 s. Por qué ese valor (no hay una constante previa en el dominio):
--   · Un móvil con la corrección de reloj de 3d (ServerClock) fecha sus eventos con la hora del
--     servidor con un error máximo de media ida y vuelta de la medida; las medidas de más de 5 s
--     se descartan, así que el error es ≤ 2,5 s. 60 s es más de 20 veces ese error.
--   · Los minutos de los jugadores se cuentan en minutos enteros: una desviación menor de 60 s
--     cambia como mucho un minuto, la resolución propia del cálculo. Más allá, el reloj está mal.
--   · NO afecta al modo sin conexión: un evento registrado sin conexión ya ha ocurrido cuando se
--     sube, así que su hora está en el pasado respecto al servidor.
-- El rechazo es EVENT_IN_FUTURE y el móvil lo trata como REINTENTABLE (no va a cuarentena): el
-- evento sigue pendiente en el móvil y no se pierde nada.
--
-- La tolerancia vive en una tabla privada (una sola fila) para que los tests de extremo a extremo,
-- que adelantan el reloj del navegador para simular minutos de partido, puedan ampliarla en el
-- Supabase LOCAL. Solo la clave de servicio puede cambiarla (nunca la app).
-- =============================================================================

create table private.event_time_policy (
  singleton boolean primary key default true check (singleton),
  max_future_ms integer not null check (max_future_ms between 0 and 172800000),
  updated_at timestamptz not null default now()
);

insert into private.event_time_policy (max_future_ms) values (60000);

alter table private.event_time_policy enable row level security;
revoke all on private.event_time_policy from public, anon, authenticated;

create function private.event_future_tolerance()
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select make_interval(secs => coalesce((select p.max_future_ms from private.event_time_policy p), 60000) / 1000.0)
$$;

revoke all on function private.event_future_tolerance() from public, anon, authenticated;

-- ¿Está la hora (ms desde 1970, como la envía el móvil) demasiado en el futuro?
create function private.is_future_event_time(p_occurred_at text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_occurred_at ~ '^-?[0-9]{1,15}$'
     and private.ms_to_timestamptz(p_occurred_at::bigint) > clock_timestamp() + private.event_future_tolerance()
$$;

revoke all on function private.is_future_event_time(text) from public, anon, authenticated;

-- Cambiar la tolerancia: SOLO con la clave de servicio (tests locales). null = valor por defecto.
create function public.set_event_time_policy(p_max_future_ms integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  update private.event_time_policy
     set max_future_ms = coalesce(p_max_future_ms, 60000), updated_at = now()
   where singleton
  returning max_future_ms
$$;

revoke all on function public.set_event_time_policy(integer) from public, anon, authenticated;
grant execute on function public.set_event_time_policy(integer) to service_role;

-- -----------------------------------------------------------------------------
-- Protección en la base de datos: ningún evento futuro, se inserte como se inserte
-- (también con la clave de servicio).
-- -----------------------------------------------------------------------------

create function private.forbid_future_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.occurred_at > clock_timestamp() + private.event_future_tolerance() then
    raise exception 'EVENT_IN_FUTURE' using errcode = 'P0001',
      detail = 'La hora del evento está en el futuro respecto a la hora del servidor.';
  end if;
  return new;
end;
$$;

create trigger b_not_in_future before insert on public.match_events
  for each row execute function private.forbid_future_events();

-- -----------------------------------------------------------------------------
-- append_match_events: se detiene en el primer evento nuevo que no puede entrar por esta vía
--   · CONTROL_TAKEN → TAKE_CONTROL_REQUIRED (3d);
--   · hora futura   → EVENT_IN_FUTURE.
-- Los anteriores se procesan; ese y los posteriores no. Un evento ya guardado (reenvío) sigue
-- siendo un duplicado idempotente.
-- -----------------------------------------------------------------------------

create or replace function public.append_match_events(p_match_id uuid, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block jsonb;
  v_block_seq integer;
  v_reason text;
  v_result jsonb;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    return private.append_match_events_unchecked(p_match_id, p_events);
  end if;

  select e.value,
         case when e.value ->> 'type' = 'CONTROL_TAKEN' then 'TAKE_CONTROL_REQUIRED' else 'EVENT_IN_FUTURE' end
    into v_block, v_reason
  from jsonb_array_elements(p_events) as e
  where not exists (select 1 from public.match_events me where me.id::text = e.value ->> 'id')
    and (
      e.value ->> 'type' = 'CONTROL_TAKEN'
      or private.is_future_event_time(e.value ->> 'occurred_at')
    )
  order by case when (e.value ->> 'seq') ~ '^[0-9]{1,9}$' then (e.value ->> 'seq')::integer end nulls last
  limit 1;

  if v_block is null then
    return private.append_match_events_unchecked(p_match_id, p_events);
  end if;

  v_block_seq := case when (v_block ->> 'seq') ~ '^[0-9]{1,9}$' then (v_block ->> 'seq')::integer end;
  v_result := private.append_match_events_unchecked(p_match_id, coalesce((
    select jsonb_agg(e.value)
    from jsonb_array_elements(p_events) as e
    where v_block_seq is not null
      and (e.value ->> 'seq') ~ '^[0-9]{1,9}$'
      and (e.value ->> 'seq')::integer < v_block_seq
  ), '[]'::jsonb));

  if jsonb_typeof(v_result -> 'rejected') = 'object' then
    return v_result;
  end if;
  return jsonb_set(
    v_result,
    '{rejected}',
    jsonb_build_object('id', v_block ->> 'id', 'seq', v_block_seq, 'reason', v_reason)
  );
end;
$$;

revoke all on function public.append_match_events(uuid, jsonb) from public, anon;
grant execute on function public.append_match_events(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- take_match_control: además, un CONTROL_TAKEN con hora futura se rechaza (EVENT_IN_FUTURE)
-- -----------------------------------------------------------------------------

create or replace function public.take_match_control(p_match_id uuid, p_expected_control_epoch integer, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_match public.matches%rowtype;
  v_event_id uuid;
  v_reason text;
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
  if not exists (select 1 from public.match_events where id = v_event_id) then
    if v_match.control_epoch is distinct from p_expected_control_epoch then
      v_reason := 'CONTROL_CHANGED';
    elsif private.is_future_event_time(p_event ->> 'occurred_at') then
      v_reason := 'EVENT_IN_FUTURE';
    end if;
  end if;

  if v_reason is not null then
    return jsonb_build_object(
      'accepted', '[]'::jsonb,
      'duplicates', '[]'::jsonb,
      'rejected', jsonb_build_object(
        'id', v_event_id,
        'seq', case when (p_event ->> 'seq') ~ '^[0-9]{1,9}$' then (p_event ->> 'seq')::integer end,
        'reason', v_reason
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
