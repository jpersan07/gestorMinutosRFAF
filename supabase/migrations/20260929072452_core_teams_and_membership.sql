-- =============================================================================
-- Gestor de Minutos · 1/4 · Equipos, temporadas, perfiles y pertenencia
--
-- Modelo multi-equipo desde el principio. La identidad viene de Supabase Auth:
-- cada entrenador tiene su propia cuenta (auth.users → profiles) y pertenece a
-- uno o varios equipos (team_members) con un rol. La pantalla "¿QUIÉN ERES?" de
-- la app es solo UX; la autorización real son estas tablas y sus políticas RLS.
--
-- Convenciones:
--   · Todas las tablas tienen RLS activado desde su creación.
--   · Los permisos se conceden explícitamente (anon no tiene acceso a nada).
--   · updated_at = hora del cambio (del móvil en las tablas sincronizadas).
--   · synced_at  = hora del SERVIDOR al recibir el cambio (cursor de descarga).
-- =============================================================================

-- Esquema privado: funciones y tablas internas, no expuestas por la API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.team_role as enum ('admin', 'coach');

-- -----------------------------------------------------------------------------
-- Utilidades de triggers
-- -----------------------------------------------------------------------------

-- Hora del servidor en cada escritura: cursor fiable aunque los relojes de los móviles difieran.
create function private.touch_synced_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

-- "Gana el último": una actualización con updated_at anterior al guardado se ignora.
-- (Reenvíos tardíos de un móvil que estuvo sin conexión no pisan cambios más nuevos.)
create function private.last_write_wins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

-- Claves inmutables: las columnas indicadas (id, team_id, match_id…) no pueden cambiar.
-- Así se puede conceder UPDATE sobre ellas para que un "upsert" idempotente funcione (reenvía
-- los mismos valores) sin permitir nunca mover una fila a otro partido o a otro equipo.
create function private.forbid_key_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_column text;
begin
  foreach v_column in array tg_argv loop
    if to_jsonb(new) -> v_column is distinct from to_jsonb(old) -> v_column then
      raise exception 'IMMUTABLE_COLUMN' using errcode = 'P0001',
        detail = format('La columna %s no se puede cambiar.', v_column);
    end if;
  end loop;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfiles (uno por cuenta de Supabase Auth)
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil público de cada cuenta (entrenador). Se crea automáticamente al crear el usuario.';

-- Al crear un usuario en Auth se crea su perfil (display_name de los metadatos o del email).
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Entrenador'), 60)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Equipos y temporadas
-- -----------------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Temporada activa (configurable). FK compuesta más abajo: debe ser de este equipo.
  current_season_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (name ~ '^[0-9]{4}-[0-9]{2}$'),
  starts_on date,
  ends_on date check (ends_on is null or starts_on is null or ends_on > starts_on),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  unique (team_id, name),
  -- Permite FKs compuestas (id, team_id): imposible referenciar una temporada de otro equipo.
  unique (id, team_id)
);

alter table public.teams
  add constraint teams_current_season_fk
  foreign key (current_season_id, id) references public.seasons (id, team_id)
  deferrable initially deferred;

create index seasons_team_synced_idx on public.seasons (team_id, synced_at);

-- -----------------------------------------------------------------------------
-- Pertenencia a equipos
-- -----------------------------------------------------------------------------

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.team_role not null default 'coach',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members (user_id);

-- -----------------------------------------------------------------------------
-- Funciones de autorización (security definer: leen team_members sin recursión de RLS)
-- -----------------------------------------------------------------------------

create function private.user_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id from public.team_members tm where tm.user_id = (select auth.uid())
$$;

create function private.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = (select auth.uid())
  )
$$;

create function private.is_team_admin(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = (select auth.uid()) and tm.role = 'admin'
  )
$$;

revoke all on function private.user_team_ids() from public;
revoke all on function private.is_team_member(uuid) from public;
revoke all on function private.is_team_admin(uuid) from public;
grant execute on function private.user_team_ids() to authenticated;
grant execute on function private.is_team_member(uuid) to authenticated;
grant execute on function private.is_team_admin(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger a_last_write_wins before update on public.teams
  for each row execute function private.last_write_wins();
create trigger z_touch_synced_at before insert or update on public.teams
  for each row execute function private.touch_synced_at();

create trigger a_last_write_wins before update on public.seasons
  for each row execute function private.last_write_wins();
create trigger z_touch_synced_at before insert or update on public.seasons
  for each row execute function private.touch_synced_at();

-- -----------------------------------------------------------------------------
-- Permisos explícitos (anon: nada; authenticated: solo lo necesario, por columnas)
-- -----------------------------------------------------------------------------

revoke all on public.profiles, public.teams, public.seasons, public.team_members from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

grant select on public.teams to authenticated;
grant update (name, current_season_id, updated_at) on public.teams to authenticated;

grant select on public.seasons to authenticated;
grant insert (id, team_id, name, starts_on, ends_on, created_at, updated_at) on public.seasons to authenticated;
grant update (name, starts_on, ends_on, updated_at) on public.seasons to authenticated;

grant select, delete on public.team_members to authenticated;
grant insert (team_id, user_id, role) on public.team_members to authenticated;
grant update (role) on public.team_members to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.seasons enable row level security;
alter table public.team_members enable row level security;

-- Perfiles: el propio y los de compañeros de algún equipo.
create policy "profiles_select_self_and_teammates" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.team_members tm
      where tm.user_id = profiles.id and tm.team_id in (select private.user_team_ids())
    )
  );

create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Equipos: los miembros los ven; solo un administrador del equipo los modifica.
create policy "teams_select_members" on public.teams
  for select to authenticated
  using (id in (select private.user_team_ids()));

create policy "teams_update_admins" on public.teams
  for update to authenticated
  using ((select private.is_team_admin(id)))
  with check ((select private.is_team_admin(id)));

-- Temporadas: los miembros las ven; los administradores las crean y modifican.
create policy "seasons_select_members" on public.seasons
  for select to authenticated
  using (team_id in (select private.user_team_ids()));

create policy "seasons_insert_admins" on public.seasons
  for insert to authenticated
  with check ((select private.is_team_admin(team_id)));

create policy "seasons_update_admins" on public.seasons
  for update to authenticated
  using ((select private.is_team_admin(team_id)))
  with check ((select private.is_team_admin(team_id)));

-- Pertenencia: los miembros ven quién está en su equipo; solo los administradores la gestionan.
create policy "team_members_select_members" on public.team_members
  for select to authenticated
  using (team_id in (select private.user_team_ids()));

create policy "team_members_insert_admins" on public.team_members
  for insert to authenticated
  with check ((select private.is_team_admin(team_id)));

create policy "team_members_update_admins" on public.team_members
  for update to authenticated
  using ((select private.is_team_admin(team_id)))
  with check ((select private.is_team_admin(team_id)));

create policy "team_members_delete_admins" on public.team_members
  for delete to authenticated
  using ((select private.is_team_admin(team_id)));
