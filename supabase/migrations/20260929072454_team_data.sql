-- =============================================================================
-- Gestor de Minutos · 2/4 · Datos del equipo
--
-- Todas las entidades del equipo llevan team_id. Las referencias entre ellas usan
-- claves foráneas COMPUESTAS (id, team_id): es imposible enlazar un partido con una
-- temporada, un escudo o un jugador de otro equipo.
--
-- Los ids los genera el móvil (UUID) para poder crear datos sin conexión; reenviar
-- el mismo registro no lo duplica.
--
-- Bloqueos de la Fase 2, aplicados también en el servidor:
--   · Datos del partido y convocatoria: editables solo antes de PLAY.
--   · Informe y minutos: solo con el partido finalizado; nada cambia una vez guardado.
-- El estado del partido (status, controlador…) NO lo puede escribir el móvil: lo
-- deriva el servidor de los eventos (migración 3).
-- =============================================================================

create type public.match_status as enum (
  'scheduled', 'setup', 'first_half', 'halftime', 'second_half', 'finished', 'saved'
);

-- Bandera de transacción que activa SOLO la función del motor (append_match_events)
-- para poder escribir el estado derivado. La API no permite fijarla desde el cliente.
create function private.engine_writing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('gestor.engine', true), '') = 'on'
$$;

-- -----------------------------------------------------------------------------
-- Formaciones (referencia; espejo de src/domain/formations.ts — un test comprueba que coinciden)
-- -----------------------------------------------------------------------------

create table public.formation_slots (
  formation_id text not null,
  slot_id text not null,
  role text not null check (role in ('GK', 'DEF', 'MID', 'ATT')),
  primary key (formation_id, slot_id)
);

insert into public.formation_slots (formation_id, slot_id, role) values
  ('4-3-3', 'GK', 'GK'), ('4-3-3', 'LB', 'DEF'), ('4-3-3', 'LCB', 'DEF'), ('4-3-3', 'RCB', 'DEF'),
  ('4-3-3', 'RB', 'DEF'), ('4-3-3', 'LCM', 'MID'), ('4-3-3', 'CM', 'MID'), ('4-3-3', 'RCM', 'MID'),
  ('4-3-3', 'LW', 'ATT'), ('4-3-3', 'ST', 'ATT'), ('4-3-3', 'RW', 'ATT'),
  ('5-3-2', 'GK', 'GK'), ('5-3-2', 'LWB', 'DEF'), ('5-3-2', 'LCB', 'DEF'), ('5-3-2', 'CB', 'DEF'),
  ('5-3-2', 'RCB', 'DEF'), ('5-3-2', 'RWB', 'DEF'), ('5-3-2', 'LCM', 'MID'), ('5-3-2', 'CM', 'MID'),
  ('5-3-2', 'RCM', 'MID'), ('5-3-2', 'LST', 'ATT'), ('5-3-2', 'RST', 'ATT'),
  ('4-3-2-1', 'GK', 'GK'), ('4-3-2-1', 'LB', 'DEF'), ('4-3-2-1', 'LCB', 'DEF'), ('4-3-2-1', 'RCB', 'DEF'),
  ('4-3-2-1', 'RB', 'DEF'), ('4-3-2-1', 'LCM', 'MID'), ('4-3-2-1', 'CM', 'MID'), ('4-3-2-1', 'RCM', 'MID'),
  ('4-3-2-1', 'LAM', 'ATT'), ('4-3-2-1', 'RAM', 'ATT'), ('4-3-2-1', 'ST', 'ATT');

-- -----------------------------------------------------------------------------
-- Jugadores
-- -----------------------------------------------------------------------------

create table public.players (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  number smallint not null check (number between 0 and 99),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (id, team_id)
);

-- Como en la app: dos jugadores ACTIVOS del mismo equipo no pueden compartir dorsal.
create unique index players_active_number_uq on public.players (team_id, number) where active;
create index players_team_synced_idx on public.players (team_id, synced_at);

-- -----------------------------------------------------------------------------
-- Escudos: la imagen vive en Supabase Storage (bucket "crests"); aquí solo la referencia.
-- Inmutables: cambiar el escudo de un partido = subir uno nuevo y apuntar a él.
-- -----------------------------------------------------------------------------

create table public.crests (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/webp', 'image/png', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 262144),
  width smallint check (width between 1 and 2048),
  height smallint check (height between 1 and 2048),
  created_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (id, team_id),
  -- Ruta canónica en el bucket: <team_id>/<crest_id>.<ext> (la carpeta del equipo es la que protege Storage).
  check (
    storage_path = team_id::text || '/' || id::text ||
      case mime_type when 'image/webp' then '.webp' when 'image/png' then '.png' else '.jpg' end
  )
);

create index crests_team_synced_idx on public.crests (team_id, synced_at);

-- -----------------------------------------------------------------------------
-- Partidos
-- -----------------------------------------------------------------------------

create table public.matches (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  season_id uuid not null,
  -- Datos editables hasta PLAY:
  opponent text not null check (char_length(btrim(opponent)) between 1 and 80),
  crest_id uuid,
  match_date date,
  kickoff_time time,
  location text check (location is null or char_length(location) <= 120),
  -- Estado DERIVADO de los eventos por el servidor (el móvil no tiene permiso para escribirlo):
  status public.match_status not null default 'scheduled',
  controller_device_id text,
  controller_user_id uuid references public.profiles (id) on delete set null,
  control_epoch integer not null default 0,
  last_seq integer not null default 0,
  managed_by uuid references public.profiles (id) on delete set null,
  saved_at timestamptz,
  -- Sincronización:
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (id, team_id),
  foreign key (season_id, team_id) references public.seasons (id, team_id),
  foreign key (crest_id, team_id) references public.crests (id, team_id)
);

create index matches_team_synced_idx on public.matches (team_id, synced_at);
create index matches_season_idx on public.matches (season_id);

-- Rival, escudo, fecha, hora y ubicación: bloqueados desde PLAY (Fase 2).
create function private.guard_match_details()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.opponent, new.crest_id, new.match_date, new.kickoff_time, new.location)
       is distinct from (old.opponent, old.crest_id, old.match_date, old.kickoff_time, old.location)
     and old.status not in ('scheduled', 'setup') then
    raise exception 'MATCH_DETAILS_LOCKED' using errcode = 'P0001',
      detail = 'El partido ya ha empezado: rival, escudo, fecha, hora y ubicación están bloqueados.';
  end if;
  return new;
end;
$$;

create trigger a_immutable_keys before update on public.matches
  for each row execute function private.forbid_key_changes('id', 'team_id', 'season_id', 'created_at');
create trigger a_last_write_wins before update on public.matches
  for each row execute function private.last_write_wins();
create trigger b_guard_match_details before update on public.matches
  for each row execute function private.guard_match_details();
create trigger z_touch_synced_at before insert or update on public.matches
  for each row execute function private.touch_synced_at();

-- -----------------------------------------------------------------------------
-- Convocatorias (una fila por partido, como en la app)
-- -----------------------------------------------------------------------------

create table public.match_squads (
  match_id uuid primary key,
  team_id uuid not null,
  player_ids uuid[] not null default '{}' check (cardinality(player_ids) <= 60),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  foreign key (match_id, team_id) references public.matches (id, team_id) on delete cascade
);

create index match_squads_team_synced_idx on public.match_squads (team_id, synced_at);

-- Editable solo antes de PLAY; todos los jugadores deben ser del equipo; sin duplicados.
-- (Al pulsar PLAY el motor congela la convocatoria del evento MATCH_STARTED.)
create function private.guard_match_squad()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.match_status;
begin
  if not private.engine_writing() then
    select m.status into v_status from public.matches m where m.id = new.match_id;
    if v_status not in ('scheduled', 'setup') then
      raise exception 'SQUAD_LOCKED' using errcode = 'P0001',
        detail = 'El partido ya ha empezado: la convocatoria no se puede cambiar.';
    end if;
  end if;

  if exists (
    select 1 from unnest(new.player_ids) as pid
    where not exists (select 1 from public.players p where p.id = pid and p.team_id = new.team_id)
  ) then
    raise exception 'SQUAD_PLAYER_NOT_IN_TEAM' using errcode = 'P0001';
  end if;

  new.player_ids := array(
    select pid from unnest(new.player_ids) with ordinality as t (pid, ord)
    group by pid order by min(ord)
  );
  return new;
end;
$$;

create trigger a_immutable_keys before update on public.match_squads
  for each row execute function private.forbid_key_changes('match_id', 'team_id');
create trigger a_last_write_wins before update on public.match_squads
  for each row execute function private.last_write_wins();
create trigger b_guard_match_squad before insert or update on public.match_squads
  for each row execute function private.guard_match_squad();
create trigger z_touch_synced_at before insert or update on public.match_squads
  for each row execute function private.touch_synced_at();

-- -----------------------------------------------------------------------------
-- Informes (RESULTADO + OBSERVACIONES)
-- -----------------------------------------------------------------------------

create table public.match_reports (
  match_id uuid primary key,
  team_id uuid not null,
  result text not null default '' check (char_length(result) <= 20),
  observations text not null default '' check (char_length(observations) <= 5000),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  foreign key (match_id, team_id) references public.matches (id, team_id) on delete cascade
);

create index match_reports_team_synced_idx on public.match_reports (team_id, synced_at);

-- -----------------------------------------------------------------------------
-- Minutos por jugador y partido (proyección calculada en el móvil con el dominio;
-- recalculable desde match_events).
-- -----------------------------------------------------------------------------

create table public.player_match_minutes (
  match_id uuid not null,
  player_id uuid not null,
  team_id uuid not null,
  seconds_played integer not null check (seconds_played between 0 and 7200),
  minutes_played smallint not null check (minutes_played between 0 and 120),
  started boolean not null,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (match_id, player_id),
  foreign key (match_id, team_id) references public.matches (id, team_id) on delete cascade,
  foreign key (player_id, team_id) references public.players (id, team_id)
);

create index player_match_minutes_team_synced_idx on public.player_match_minutes (team_id, synced_at);
create index player_match_minutes_player_idx on public.player_match_minutes (player_id);

-- Informe y minutos: se escriben con el partido FINALIZADO. Una vez GUARDADO, nada cambia
-- (se admite reescribir exactamente los mismos valores, para que un reenvío no falle).
-- Se compara con la fila guardada (no con OLD) porque en un upsert también se ejecuta el
-- trigger BEFORE INSERT aunque la fila termine actualizándose.
create function private.guard_finished_match_data()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.match_status;
  v_unchanged boolean := false;
begin
  select m.status into v_status from public.matches m where m.id = new.match_id;

  if v_status = 'finished' then
    return new;
  end if;

  if v_status = 'saved' then
    if tg_table_name = 'match_reports' then
      select (r.result, r.observations) is not distinct from (new.result, new.observations) into v_unchanged
      from public.match_reports r where r.match_id = new.match_id;
    elsif tg_table_name = 'player_match_minutes' then
      select (x.seconds_played, x.minutes_played, x.started)
               is not distinct from (new.seconds_played, new.minutes_played, new.started) into v_unchanged
      from public.player_match_minutes x where x.match_id = new.match_id and x.player_id = new.player_id;
    end if;
    if coalesce(v_unchanged, false) then
      return new;
    end if;
  end if;

  raise exception '%', case when v_status = 'saved' then 'MATCH_LOCKED' else 'MATCH_NOT_FINISHED' end
    using errcode = 'P0001';
end;
$$;

create trigger a_immutable_keys before update on public.match_reports
  for each row execute function private.forbid_key_changes('match_id', 'team_id');
create trigger a_last_write_wins before update on public.match_reports
  for each row execute function private.last_write_wins();
create trigger b_guard_finished before insert or update on public.match_reports
  for each row execute function private.guard_finished_match_data();
create trigger z_touch_synced_at before insert or update on public.match_reports
  for each row execute function private.touch_synced_at();

create trigger a_immutable_keys before update on public.player_match_minutes
  for each row execute function private.forbid_key_changes('match_id', 'player_id', 'team_id');
create trigger a_last_write_wins before update on public.player_match_minutes
  for each row execute function private.last_write_wins();
create trigger b_guard_finished before insert or update on public.player_match_minutes
  for each row execute function private.guard_finished_match_data();
create trigger z_touch_synced_at before insert or update on public.player_match_minutes
  for each row execute function private.touch_synced_at();

create trigger z_touch_synced_at before insert or update on public.players
  for each row execute function private.touch_synced_at();
create trigger a_immutable_keys before update on public.players
  for each row execute function private.forbid_key_changes('id', 'team_id', 'created_at');
create trigger a_last_write_wins before update on public.players
  for each row execute function private.last_write_wins();

create trigger z_touch_synced_at before insert on public.crests
  for each row execute function private.touch_synced_at();

-- -----------------------------------------------------------------------------
-- Registro de errores técnicos de los móviles (PRD §33)
-- -----------------------------------------------------------------------------

create table public.client_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  device_id text check (device_id is null or char_length(device_id) <= 100),
  level text not null default 'error' check (level in ('error', 'warn', 'info')),
  message text not null check (char_length(message) <= 2000),
  context jsonb check (context is null or pg_column_size(context) <= 16384),
  created_at timestamptz not null default now()
);

create index client_logs_team_created_idx on public.client_logs (team_id, created_at);

-- -----------------------------------------------------------------------------
-- Permisos explícitos por columna
-- -----------------------------------------------------------------------------

revoke all on public.formation_slots, public.players, public.crests, public.matches,
  public.match_squads, public.match_reports, public.player_match_minutes, public.client_logs
  from anon, authenticated;

grant select on public.formation_slots to authenticated;

grant select on public.players to authenticated;
grant insert (id, team_id, name, number, active, created_at, updated_at) on public.players to authenticated;
-- Las claves se incluyen para permitir upsert; el trigger a_immutable_keys impide cambiarlas.
grant update (id, team_id, created_at, name, number, active, updated_at) on public.players to authenticated;

grant select on public.crests to authenticated;
grant insert (id, team_id, storage_path, mime_type, size_bytes, width, height, created_at) on public.crests to authenticated;

grant select on public.matches to authenticated;
grant insert (id, team_id, season_id, opponent, crest_id, match_date, kickoff_time, location, created_at, updated_at)
  on public.matches to authenticated;
grant update (id, team_id, season_id, created_at, opponent, crest_id, match_date, kickoff_time, location, updated_at)
  on public.matches to authenticated;

grant select on public.match_squads to authenticated;
grant insert (match_id, team_id, player_ids, updated_at) on public.match_squads to authenticated;
grant update (match_id, team_id, player_ids, updated_at) on public.match_squads to authenticated;

grant select on public.match_reports to authenticated;
grant insert (match_id, team_id, result, observations, updated_at) on public.match_reports to authenticated;
grant update (match_id, team_id, result, observations, updated_at) on public.match_reports to authenticated;

grant select on public.player_match_minutes to authenticated;
grant insert (match_id, player_id, team_id, seconds_played, minutes_played, started, updated_at)
  on public.player_match_minutes to authenticated;
grant update (match_id, player_id, team_id, seconds_played, minutes_played, started, updated_at)
  on public.player_match_minutes to authenticated;

grant insert (id, team_id, device_id, level, message, context, created_at) on public.client_logs to authenticated;
grant select on public.client_logs to authenticated;

-- -----------------------------------------------------------------------------
-- RLS: cada usuario solo accede a los datos de sus equipos
-- -----------------------------------------------------------------------------

alter table public.formation_slots enable row level security;
alter table public.players enable row level security;
alter table public.crests enable row level security;
alter table public.matches enable row level security;
alter table public.match_squads enable row level security;
alter table public.match_reports enable row level security;
alter table public.player_match_minutes enable row level security;
alter table public.client_logs enable row level security;

create policy "formation_slots_select_all" on public.formation_slots
  for select to authenticated using (true);

-- Jugadores
create policy "players_select_members" on public.players
  for select to authenticated using (team_id in (select private.user_team_ids()));
create policy "players_insert_members" on public.players
  for insert to authenticated with check (team_id in (select private.user_team_ids()));
create policy "players_update_members" on public.players
  for update to authenticated
  using (team_id in (select private.user_team_ids()))
  with check (team_id in (select private.user_team_ids()));

-- Escudos (sin update ni delete: inmutables)
create policy "crests_select_members" on public.crests
  for select to authenticated using (team_id in (select private.user_team_ids()));
create policy "crests_insert_members" on public.crests
  for insert to authenticated with check (team_id in (select private.user_team_ids()));

-- Partidos (sin delete: tienen historial)
create policy "matches_select_members" on public.matches
  for select to authenticated using (team_id in (select private.user_team_ids()));
create policy "matches_insert_members" on public.matches
  for insert to authenticated with check (team_id in (select private.user_team_ids()));
create policy "matches_update_members" on public.matches
  for update to authenticated
  using (team_id in (select private.user_team_ids()))
  with check (team_id in (select private.user_team_ids()));

-- Convocatorias
create policy "match_squads_select_members" on public.match_squads
  for select to authenticated using (team_id in (select private.user_team_ids()));
create policy "match_squads_insert_members" on public.match_squads
  for insert to authenticated with check (team_id in (select private.user_team_ids()));
create policy "match_squads_update_members" on public.match_squads
  for update to authenticated
  using (team_id in (select private.user_team_ids()))
  with check (team_id in (select private.user_team_ids()));

-- Informes
create policy "match_reports_select_members" on public.match_reports
  for select to authenticated using (team_id in (select private.user_team_ids()));
create policy "match_reports_insert_members" on public.match_reports
  for insert to authenticated with check (team_id in (select private.user_team_ids()));
create policy "match_reports_update_members" on public.match_reports
  for update to authenticated
  using (team_id in (select private.user_team_ids()))
  with check (team_id in (select private.user_team_ids()));

-- Minutos
create policy "player_match_minutes_select_members" on public.player_match_minutes
  for select to authenticated using (team_id in (select private.user_team_ids()));
create policy "player_match_minutes_insert_members" on public.player_match_minutes
  for insert to authenticated with check (team_id in (select private.user_team_ids()));
create policy "player_match_minutes_update_members" on public.player_match_minutes
  for update to authenticated
  using (team_id in (select private.user_team_ids()))
  with check (team_id in (select private.user_team_ids()));

-- Logs: cada usuario escribe los suyos; solo los administradores del equipo los leen.
create policy "client_logs_insert_own" on public.client_logs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (team_id is null or team_id in (select private.user_team_ids()))
  );
create policy "client_logs_select_admins" on public.client_logs
  for select to authenticated using (team_id is not null and (select private.is_team_admin(team_id)));
