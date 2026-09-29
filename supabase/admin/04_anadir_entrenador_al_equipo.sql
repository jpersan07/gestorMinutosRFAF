-- =============================================================================
-- 04 · AÑADIR un entrenador a un equipo (o cambiar su rol) y poner su nombre visible
--
-- Antes: crea la cuenta en el panel → Authentication → Users → Add user → Create new user,
--        con su email, "Auto Confirm User" marcado y una contraseña ALEATORIA que NO guardes
--        (el entrenador pondrá la suya con "¿Has olvidado la contraseña?"). Ver la guía.
-- Dónde: SQL Editor. Sustituye los valores entre < >.
-- Rol: 'coach' (entrenador) o 'admin' (además puede gestionar el equipo desde la API).
-- =============================================================================
do $$
declare
  -- DATOS ---------------------------------------------------------------------
  v_email        text := '<EMAIL_DEL_ENTRENADOR>';
  v_team_id_text text := '<ID_DEL_EQUIPO>';
  v_role_text    text := '<coach o admin>';
  v_display_name text := '<NOMBRE_VISIBLE>';          -- p. ej. 'Isaac' (se ve en "Controlado por…")
  -- ---------------------------------------------------------------------------
  v_user_id uuid;
  v_team_id uuid;
  v_role public.team_role;
begin
  if v_email like '%<%' or v_team_id_text like '%<%' or v_role_text like '%<%' or v_display_name like '%<%' then
    raise exception 'Sustituye los valores entre < > antes de ejecutar.';
  end if;
  v_team_id := v_team_id_text::uuid;
  v_role := btrim(v_role_text)::public.team_role;

  select id into v_user_id from auth.users where lower(email) = lower(btrim(v_email));
  if v_user_id is null then
    raise exception 'No existe ninguna cuenta con el email %. Créala primero en Authentication → Users.', v_email;
  end if;
  if not exists (select 1 from public.teams where id = v_team_id) then
    raise exception 'No existe ningún equipo con id %.', v_team_id;
  end if;

  update public.profiles set display_name = btrim(v_display_name), updated_at = now() where id = v_user_id;

  insert into public.team_members (team_id, user_id, role) values (v_team_id, v_user_id, v_role)
  on conflict (team_id, user_id) do update set role = excluded.role;
  raise notice '% es ahora % del equipo %.', v_email, v_role, v_team_id;
end;
$$;
