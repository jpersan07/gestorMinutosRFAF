-- =============================================================================
-- Gestor de Minutos · 3/4 · Eventos del partido, validación y control único
--
-- match_events es el historial INMUTABLE del partido (append-only): nunca se edita ni
-- se borra; las correcciones son eventos compensatorios (SUBSTITUTION_UNDONE).
--
-- El motor del partido sigue siendo el dominio TypeScript de la app. El servidor NO
-- calcula minutos ni pinta nada: actúa como GUARDIÁN y no se fía del móvil. Cada evento
-- entra solo a través de public.append_match_events(), que comprueba:
--   · pertenencia al equipo y autenticación (el autor es auth.uid(), no lo que diga el móvil);
--   · orden estricto: seq = último + 1 (sin huecos ni duplicados; reintentos idempotentes);
--   · CONTROL ÚNICO: solo el dispositivo+usuario controlador puede escribir; SETUP_STARTED
--     y CONTROL_TAKEN lo asignan; la fila del partido se bloquea (FOR UPDATE) durante la
--     llamada, así que dos móviles nunca pueden escribir a la vez el mismo seq;
--   · transiciones válidas de la máquina de estados (scheduled → … → saved);
--   · integridad de alineaciones, convocatoria y cambios (posiciones de la formación,
--     sin duplicados, jugadores convocados, quién está en el campo);
--   · coherencia temporal: el segundo de partido declarado debe coincidir con los
--     timestamps (no se pueden "inventar" minutos), final de parte a la hora exacta,
--     15 s mínimos de descanso;
--   · bloqueo total una vez guardado (y RESULTADO obligatorio para guardar).
-- El estado del partido en public.matches (status, controlador…) se DERIVA de aquí.
-- =============================================================================

create type public.match_event_type as enum (
  'SETUP_STARTED', 'CONTROL_TAKEN', 'LINEUP_CONFIRMED', 'MATCH_STARTED', 'HALF_STARTED',
  'PLAYER_OUT', 'PLAYER_IN', 'SUBSTITUTION_UNDONE', 'HALF_ENDED', 'MATCH_ENDED', 'MATCH_SAVED'
);

create table public.match_events (
  id uuid primary key,
  team_id uuid not null,
  match_id uuid not null,
  seq integer not null check (seq > 0),
  event_type public.match_event_type not null,
  -- Momento real en el dispositivo (hora del móvil; ver coherencia temporal en la validación).
  occurred_at timestamptz not null,
  device_id text not null check (char_length(device_id) between 1 and 100),
  -- Autor según Supabase Auth (lo pone el servidor). Historial: no se borra el usuario si tiene eventos.
  user_id uuid not null references public.profiles (id),
  half smallint check (half in (1, 2)),
  match_second integer check (match_second between 0 and 7200),
  player_id uuid,
  related_player_id uuid,
  substitution_id uuid,
  slot_id text check (slot_id is null or char_length(slot_id) <= 10),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  -- Hora del servidor al recibirlo: cursor de descarga.
  received_at timestamptz not null default now(),
  unique (match_id, seq),
  foreign key (match_id, team_id) references public.matches (id, team_id) on delete cascade
);

create index match_events_team_received_idx on public.match_events (team_id, received_at);

comment on table public.match_events is
  'Historial inmutable del partido. Solo se añade mediante append_match_events(); nunca se edita ni se borra.';

-- Inmutabilidad garantizada en la base de datos (también frente a service_role y cascadas).
create function private.forbid_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'MATCH_EVENTS_ARE_IMMUTABLE' using errcode = 'P0001',
    detail = 'El historial del partido no se puede modificar ni borrar; las correcciones son eventos nuevos.';
end;
$$;

create trigger match_events_immutable before update or delete on public.match_events
  for each row execute function private.forbid_event_changes();
create trigger match_events_no_truncate before truncate on public.match_events
  for each statement execute function private.forbid_event_changes();

-- -----------------------------------------------------------------------------
-- Estado de validación (interno, no expuesto por la API)
-- -----------------------------------------------------------------------------

create table private.match_states (
  match_id uuid primary key references public.matches (id) on delete cascade,
  team_id uuid not null,
  status public.match_status not null default 'scheduled',
  controller_device_id text,
  controller_user_id uuid,
  control_epoch integer not null default 0,
  last_seq integer not null default 0,
  half_duration_s integer,
  squad uuid[] not null default '{}',
  lineup1 jsonb,
  lineup2 jsonb,
  on_field jsonb not null default '{}',          -- posición → jugador
  half1_started_at timestamptz,
  half1_ended_at timestamptz,
  half2_started_at timestamptz,
  half2_ended_at timestamptz,
  substitutions jsonb not null default '[]',     -- [{id, half, slot, out, in, undone}]
  pending_sub jsonb,                             -- PLAYER_OUT a la espera de su PLAYER_IN
  saved_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Defensa en profundidad: aunque el esquema private no está expuesto, RLS activo sin políticas.
alter table private.match_states enable row level security;
revoke all on private.match_states from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------

-- Milisegundos (Date.now() del móvil) → timestamptz exacto (aritmética entera, sin flotantes).
create function private.ms_to_timestamptz(p_ms bigint)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select timestamptz '1970-01-01 00:00:00+00' + p_ms * interval '1 millisecond'
$$;

-- Valida una alineación: formación conocida, exactamente sus posiciones, 11 jugadores
-- distintos y todos convocados. Devuelve el motivo del rechazo o null.
create function private.validate_lineup(p_lineup jsonb, p_squad uuid[])
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_formation text := p_lineup ->> 'formationId';
  v_slots jsonb := p_lineup -> 'slots';
  v_expected text[];
  v_given text[];
  v_players uuid[];
begin
  if v_formation is null or jsonb_typeof(v_slots) is distinct from 'object' then
    return 'INVALID_LINEUP';
  end if;

  select array_agg(fs.slot_id order by fs.slot_id) into v_expected
  from public.formation_slots fs where fs.formation_id = v_formation;
  if v_expected is null then
    return 'UNKNOWN_FORMATION';
  end if;

  select array_agg(k order by k) into v_given from jsonb_object_keys(v_slots) as k;
  if exists (select 1 from unnest(v_given) as k where k <> all (v_expected)) then
    return 'UNKNOWN_SLOT';
  end if;
  if v_given is distinct from v_expected then
    return 'LINEUP_INCOMPLETE';
  end if;

  begin
    select array_agg((e.value #>> '{}')::uuid) into v_players from jsonb_each(v_slots) as e;
  exception when others then
    return 'INVALID_LINEUP';
  end;
  if exists (select 1 from unnest(v_players) as p where p is null) then
    return 'INVALID_LINEUP';
  end if;
  if (select count(distinct p) from unnest(v_players) as p) <> cardinality(v_players) then
    return 'PLAYER_DUPLICATED';
  end if;
  if exists (select 1 from unnest(v_players) as p where p <> all (coalesce(p_squad, '{}'))) then
    return 'PLAYER_NOT_IN_SQUAD';
  end if;
  return null;
end;
$$;

revoke all on function private.ms_to_timestamptz(bigint) from public;
revoke all on function private.validate_lineup(jsonb, uuid[]) from public;

-- -----------------------------------------------------------------------------
-- append_match_events: única puerta de entrada de eventos
--
-- p_events: array JSON de eventos en orden de seq, cada uno:
--   { id, seq, type, occurred_at (ms), device_id, half?, match_second?, player_id?,
--     related_player_id?, substitution_id?, slot_id?, payload? }
-- Procesa en orden y se detiene en el primer rechazo (los anteriores quedan aceptados).
-- Devuelve { accepted: [ids], duplicates: [ids], rejected: null | {id, seq, reason},
--            match: {status, last_seq, controller_device_id, control_epoch} }
-- -----------------------------------------------------------------------------

create function public.append_match_events(p_match_id uuid, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_match public.matches%rowtype;
  s private.match_states%rowtype;
  v_item jsonb;
  v_existing public.match_events%rowtype;
  v_accepted uuid[] := '{}';
  v_duplicates uuid[] := '{}';
  v_rejected jsonb := null;
  v_froze_squad boolean := false;
  -- Campos del evento
  v_id uuid;
  v_seq integer;
  v_type public.match_event_type;
  v_at timestamptz;
  v_device text;
  v_half smallint;
  v_second integer;
  v_player uuid;
  v_related uuid;
  v_sub uuid;
  v_slot text;
  v_payload jsonb;
  -- Auxiliares
  v_reason text;
  v_play_half integer;
  v_half_start timestamptz;
  v_half_end timestamptz;
  v_expected_second integer;
  v_saved_squad uuid[];
  v_squad uuid[];
  v_duration integer;
  v_target jsonb;
  v_target_idx bigint;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'INVALID_PAYLOAD' using errcode = '22023';
  end if;

  -- Bloqueo de la fila del partido: serializa escrituras concurrentes (control único).
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or not private.is_team_member(v_match.team_id) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform set_config('gestor.engine', 'on', true);

  insert into private.match_states (match_id, team_id) values (p_match_id, v_match.team_id)
  on conflict (match_id) do nothing;
  select * into s from private.match_states where match_id = p_match_id for update;

  for v_item in
    select e.value from jsonb_array_elements(p_events) as e
    order by case when (e.value ->> 'seq') ~ '^[0-9]{1,9}$' then (e.value ->> 'seq')::integer end nulls last
  loop
    v_reason := null;

    -- 1) Forma del evento
    begin
      v_id := (v_item ->> 'id')::uuid;
      v_seq := (v_item ->> 'seq')::integer;
      v_type := (v_item ->> 'type')::public.match_event_type;
      v_at := private.ms_to_timestamptz((v_item ->> 'occurred_at')::bigint);
      v_device := nullif(btrim(v_item ->> 'device_id'), '');
      v_half := (v_item ->> 'half')::smallint;
      v_second := (v_item ->> 'match_second')::integer;
      v_player := (v_item ->> 'player_id')::uuid;
      v_related := (v_item ->> 'related_player_id')::uuid;
      v_sub := (v_item ->> 'substitution_id')::uuid;
      v_slot := v_item ->> 'slot_id';
      v_payload := coalesce(v_item -> 'payload', '{}'::jsonb);
    exception when others then
      v_reason := 'INVALID_EVENT';
    end;
    if v_reason is null and (
      v_id is null or v_seq is null or v_type is null or v_at is null or v_device is null
      or char_length(v_device) > 100 or jsonb_typeof(v_payload) is distinct from 'object'
    ) then
      v_reason := 'INVALID_EVENT';
    end if;

    -- 2) Reintento idempotente: el mismo evento ya guardado se da por aceptado.
    if v_reason is null then
      select * into v_existing from public.match_events where id = v_id;
      if found then
        if v_existing.match_id = p_match_id and v_existing.seq = v_seq then
          v_duplicates := v_duplicates || v_id;
          continue;
        end if;
        v_reason := 'ID_CONFLICT';
      end if;
    end if;

    -- 3) Orden, bloqueo y autoridad (control único)
    if v_reason is null then
      if v_seq <= s.last_seq then
        v_reason := 'SEQ_CONFLICT';          -- otro dispositivo escribió antes
      elsif v_seq > s.last_seq + 1 then
        v_reason := 'SEQ_GAP';               -- faltan eventos anteriores
      elsif s.status = 'saved' then
        v_reason := 'MATCH_LOCKED';
      elsif s.pending_sub is not null and v_type <> 'PLAYER_IN' then
        v_reason := 'SUBSTITUTION_INCOMPLETE';
      elsif s.half2_ended_at is not null and s.status = 'second_half' and v_type <> 'MATCH_ENDED' then
        v_reason := 'MATCH_END_EXPECTED';
      elsif v_type = 'SETUP_STARTED' then
        if s.status <> 'scheduled' then
          v_reason := 'INVALID_TRANSITION';
        end if;
      elsif v_type = 'CONTROL_TAKEN' then
        if s.status = 'scheduled' then
          v_reason := 'INVALID_TRANSITION';
        elsif s.controller_device_id = v_device and s.controller_user_id = v_uid then
          v_reason := 'ALREADY_CONTROLLER';
        end if;
      elsif s.controller_device_id is distinct from v_device or s.controller_user_id is distinct from v_uid then
        v_reason := 'NOT_CONTROLLER';
      end if;
    end if;

    -- 4) Transición y contenido según el tipo (el estado solo se modifica si es válido)
    if v_reason is null then
      v_play_half := case s.status when 'first_half' then 1 when 'second_half' then 2 end;
      v_half_start := case v_play_half when 1 then s.half1_started_at when 2 then s.half2_started_at end;
      v_half_end := v_half_start + make_interval(secs => s.half_duration_s);
      v_expected_second := case when v_play_half is not null then
        (v_play_half - 1) * s.half_duration_s
        + least(s.half_duration_s, greatest(0, floor(extract(epoch from (v_at - v_half_start)))::integer))
      end;

      case v_type
        when 'SETUP_STARTED' then
          s.status := 'setup';
          s.controller_device_id := v_device;
          s.controller_user_id := v_uid;
          s.control_epoch := s.control_epoch + 1;

        when 'CONTROL_TAKEN' then
          s.controller_device_id := v_device;
          s.controller_user_id := v_uid;
          s.control_epoch := s.control_epoch + 1;

        when 'LINEUP_CONFIRMED' then
          if v_half = 1 and s.status = 'setup' and s.half_duration_s is null then
            select ms.player_ids into v_saved_squad from public.match_squads ms where ms.match_id = p_match_id;
            v_reason := private.validate_lineup(v_payload -> 'lineup', coalesce(v_saved_squad, '{}'));
            if v_reason is null then
              s.lineup1 := v_payload -> 'lineup';
            end if;
          elsif v_half = 2 and s.status = 'halftime' then
            v_reason := private.validate_lineup(v_payload -> 'lineup', s.squad);
            if v_reason is null then
              s.lineup2 := v_payload -> 'lineup';
            end if;
          else
            v_reason := 'INVALID_TRANSITION';
          end if;

        when 'MATCH_STARTED' then
          if s.status <> 'setup' or s.half_duration_s is not null then
            v_reason := 'INVALID_TRANSITION';
          elsif s.lineup1 is null then
            v_reason := 'LINEUP_NOT_CONFIRMED';
          else
            begin
              v_duration := (v_payload ->> 'halfDurationS')::integer;
              select coalesce(array_agg(x::uuid), '{}') into v_squad
              from jsonb_array_elements_text(v_payload -> 'squad') as x;
            exception when others then
              v_reason := 'INVALID_EVENT';
            end;
            if v_reason is null then
              if v_duration is null or v_duration not between 60 and 3600 then
                v_reason := 'INVALID_DURATION';
              elsif (select count(distinct p) from unnest(v_squad) as p) <> cardinality(v_squad) then
                v_reason := 'INVALID_SQUAD';
              elsif exists (
                select 1 from unnest(v_squad) as p
                where not exists (select 1 from public.players pl where pl.id = p and pl.team_id = v_match.team_id)
              ) then
                v_reason := 'SQUAD_PLAYER_NOT_IN_TEAM';
              else
                v_reason := private.validate_lineup(s.lineup1, v_squad);
                if v_reason is null then
                  s.half_duration_s := v_duration;
                  s.squad := v_squad;
                  v_froze_squad := true;
                end if;
              end if;
            end if;
          end if;

        when 'HALF_STARTED' then
          if v_half = 1 then
            if s.status <> 'setup' or s.half_duration_s is null then
              v_reason := 'INVALID_TRANSITION';
            elsif v_second is distinct from 0 then
              v_reason := 'INVALID_MATCH_SECOND';
            else
              s.status := 'first_half';
              s.half1_started_at := v_at;
              s.on_field := s.lineup1 -> 'slots';
            end if;
          elsif v_half = 2 then
            if s.status <> 'halftime' then
              v_reason := 'INVALID_TRANSITION';
            elsif s.lineup2 is null then
              v_reason := 'LINEUP_NOT_CONFIRMED';
            elsif v_at < s.half1_ended_at + interval '15 seconds' then
              v_reason := 'HALFTIME_WAIT';
            elsif v_second is distinct from s.half_duration_s then
              v_reason := 'INVALID_MATCH_SECOND';
            else
              s.status := 'second_half';
              s.half2_started_at := v_at;
              s.on_field := s.lineup2 -> 'slots';
            end if;
          else
            v_reason := 'INVALID_EVENT';
          end if;

        when 'PLAYER_OUT' then
          if v_play_half is null then
            v_reason := 'INVALID_TRANSITION';
          elsif v_half is distinct from v_play_half then
            v_reason := 'INVALID_EVENT';
          elsif v_at >= v_half_end then
            v_reason := 'HALF_OVER';
          elsif v_at < v_half_start then
            v_reason := 'INVALID_TIME';
          elsif v_second is distinct from v_expected_second then
            v_reason := 'INVALID_MATCH_SECOND';
          elsif v_sub is null or v_slot is null or v_player is null or v_related is null then
            v_reason := 'INVALID_EVENT';
          elsif v_player = v_related then
            v_reason := 'SAME_PLAYER';
          elsif (s.on_field ->> v_slot) is distinct from v_player::text then
            v_reason := 'PLAYER_NOT_ON_FIELD';
          elsif exists (select 1 from jsonb_each_text(s.on_field) as f where f.value = v_related::text) then
            v_reason := 'PLAYER_ALREADY_ON_FIELD';
          elsif not (v_related = any (s.squad)) then
            v_reason := 'PLAYER_NOT_IN_SQUAD';
          elsif exists (select 1 from jsonb_array_elements(s.substitutions) as x where x ->> 'id' = v_sub::text) then
            v_reason := 'SUBSTITUTION_ID_REUSED';
          else
            s.pending_sub := jsonb_build_object(
              'id', v_sub, 'half', v_half, 'slot', v_slot, 'out', v_player, 'in', v_related,
              'second', v_second, 'at', v_at
            );
            s.on_field := s.on_field - v_slot;
          end if;

        when 'PLAYER_IN' then
          if s.pending_sub is null then
            v_reason := 'INVALID_TRANSITION';
          elsif v_sub::text is distinct from s.pending_sub ->> 'id'
             or v_slot is distinct from s.pending_sub ->> 'slot'
             or v_player::text is distinct from s.pending_sub ->> 'in'
             or v_related::text is distinct from s.pending_sub ->> 'out'
             or v_half::text is distinct from s.pending_sub ->> 'half'
             or v_second::text is distinct from s.pending_sub ->> 'second'
             or v_at is distinct from (s.pending_sub ->> 'at')::timestamptz then
            v_reason := 'SUBSTITUTION_MISMATCH';
          else
            s.on_field := s.on_field || jsonb_build_object(v_slot, v_player);
            s.substitutions := s.substitutions || jsonb_build_array(jsonb_build_object(
              'id', v_sub, 'half', v_half, 'slot', v_slot, 'out', v_related, 'in', v_player, 'undone', false
            ));
            s.pending_sub := null;
          end if;

        when 'SUBSTITUTION_UNDONE' then
          if v_play_half is null then
            v_reason := 'INVALID_TRANSITION';
          elsif v_half is distinct from v_play_half then
            v_reason := 'INVALID_EVENT';
          elsif v_at >= v_half_end then
            v_reason := 'HALF_OVER';
          elsif v_second is distinct from v_expected_second then
            v_reason := 'INVALID_MATCH_SECOND';
          else
            -- Solo se puede anular el último cambio no anulado de la parte en juego.
            select x.value, x.ord into v_target, v_target_idx
            from jsonb_array_elements(s.substitutions) with ordinality as x (value, ord)
            where not (x.value ->> 'undone')::boolean and (x.value ->> 'half')::integer = v_play_half
            order by x.ord desc
            limit 1;
            if v_target is null then
              v_reason := 'NOTHING_TO_UNDO';
            elsif v_target ->> 'id' is distinct from v_sub::text then
              v_reason := 'NOT_LAST_SUBSTITUTION';
            elsif (s.on_field ->> (v_target ->> 'slot')) is distinct from v_target ->> 'in'
               or exists (select 1 from jsonb_each_text(s.on_field) as f where f.value = v_target ->> 'out') then
              v_reason := 'UNDO_CONFLICT';
            else
              s.on_field := s.on_field || jsonb_build_object(v_target ->> 'slot', v_target ->> 'out');
              s.substitutions := jsonb_set(s.substitutions, array[(v_target_idx - 1)::text, 'undone'], 'true');
            end if;
          end if;

        when 'HALF_ENDED' then
          if v_play_half is null or s.half2_ended_at is not null then
            v_reason := 'INVALID_TRANSITION';
          elsif v_half is distinct from v_play_half then
            v_reason := 'INVALID_EVENT';
          elsif v_at is distinct from v_half_end then
            v_reason := 'INVALID_HALF_END';     -- el final se registra a la hora exacta (inicio + duración)
          elsif v_second is distinct from v_play_half * s.half_duration_s then
            v_reason := 'INVALID_MATCH_SECOND';
          elsif v_play_half = 1 then
            s.status := 'halftime';
            s.half1_ended_at := v_at;
          else
            s.half2_ended_at := v_at;
          end if;

        when 'MATCH_ENDED' then
          if s.status <> 'second_half' or s.half2_ended_at is null then
            v_reason := 'INVALID_TRANSITION';
          elsif v_at is distinct from s.half2_ended_at then
            v_reason := 'INVALID_HALF_END';
          elsif v_second is distinct from 2 * s.half_duration_s then
            v_reason := 'INVALID_MATCH_SECOND';
          else
            s.status := 'finished';
          end if;

        when 'MATCH_SAVED' then
          if s.status <> 'finished' then
            v_reason := 'INVALID_TRANSITION';
          elsif not exists (
            select 1 from public.match_reports r where r.match_id = p_match_id and btrim(r.result) <> ''
          ) then
            v_reason := 'RESULT_REQUIRED';
          else
            s.status := 'saved';
            s.saved_at := v_at;
          end if;
      end case;
    end if;

    if v_reason is not null then
      v_rejected := jsonb_build_object('id', v_id, 'seq', v_seq, 'reason', v_reason);
      exit;
    end if;

    insert into public.match_events (
      id, team_id, match_id, seq, event_type, occurred_at, device_id, user_id,
      half, match_second, player_id, related_player_id, substitution_id, slot_id, payload
    ) values (
      v_id, v_match.team_id, p_match_id, v_seq, v_type, v_at, v_device, v_uid,
      v_half, v_second, v_player, v_related, v_sub, v_slot, v_payload
    );
    s.last_seq := v_seq;
    v_accepted := v_accepted || v_id;
  end loop;

  if cardinality(v_accepted) > 0 then
    update private.match_states set
      status = s.status,
      controller_device_id = s.controller_device_id,
      controller_user_id = s.controller_user_id,
      control_epoch = s.control_epoch,
      last_seq = s.last_seq,
      half_duration_s = s.half_duration_s,
      squad = s.squad,
      lineup1 = s.lineup1,
      lineup2 = s.lineup2,
      on_field = s.on_field,
      half1_started_at = s.half1_started_at,
      half1_ended_at = s.half1_ended_at,
      half2_started_at = s.half2_started_at,
      half2_ended_at = s.half2_ended_at,
      substitutions = s.substitutions,
      pending_sub = s.pending_sub,
      saved_at = s.saved_at,
      updated_at = now()
    where match_id = p_match_id;

    -- Estado derivado visible para la app (y para Realtime en el futuro).
    update public.matches set
      status = s.status,
      controller_device_id = s.controller_device_id,
      controller_user_id = s.controller_user_id,
      control_epoch = s.control_epoch,
      last_seq = s.last_seq,
      managed_by = s.controller_user_id,
      saved_at = s.saved_at
    where id = p_match_id;

    -- Al pulsar PLAY la convocatoria queda congelada tal como la registró el evento.
    if v_froze_squad then
      insert into public.match_squads (match_id, team_id, player_ids, updated_at)
      values (p_match_id, v_match.team_id, s.squad, now())
      on conflict (match_id) do update
        set player_ids = excluded.player_ids,
            updated_at = greatest(public.match_squads.updated_at, excluded.updated_at);
    end if;
  end if;

  return jsonb_build_object(
    'accepted', to_jsonb(v_accepted),
    'duplicates', to_jsonb(v_duplicates),
    'rejected', v_rejected,
    'match', jsonb_build_object(
      'status', s.status,
      'last_seq', s.last_seq,
      'controller_device_id', s.controller_device_id,
      'control_epoch', s.control_epoch
    )
  );
end;
$$;

revoke all on function public.append_match_events(uuid, jsonb) from public, anon;
grant execute on function public.append_match_events(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Permisos y RLS: los miembros leen el historial; nadie lo escribe directamente.
-- -----------------------------------------------------------------------------

revoke all on public.match_events from anon, authenticated;
grant select on public.match_events to authenticated;

alter table public.match_events enable row level security;

create policy "match_events_select_members" on public.match_events
  for select to authenticated using (team_id in (select private.user_team_ids()));
