-- =============================================================================
-- 05 · RETIRAR a un entrenador de un equipo
--
-- Su cuenta sigue existiendo (se puede borrar en Authentication → Users si ya no la necesita),
-- pero deja de ver el equipo. Sus eventos y partidos anteriores se conservan en el historial.
-- Si tiene la app abierta, al recuperar la conexión se le cierra la sesión (salvo durante un
-- partido en juego: entonces se le avisa y se le cierra al terminar).
-- No se puede retirar al ÚLTIMO administrador de un equipo.
-- Dónde: SQL Editor. Sustituye los valores entre < >.
-- =============================================================================
do $$
declare
  -- DATOS ---------------------------------------------------------------------
  v_email        text := '<EMAIL_DEL_ENTRENADOR>';
  v_team_id_text text := '<ID_DEL_EQUIPO>';
  -- ---------------------------------------------------------------------------
  v_user_id uuid;
  v_team_id uuid;
  v_role public.team_role;
  v_live record;
begin
  if v_email like '%<%' or v_team_id_text like '%<%' then
    raise exception 'Sustituye los valores entre < > antes de ejecutar.';
  end if;
  v_team_id := v_team_id_text::uuid;
  select id into v_user_id from auth.users where lower(email) = lower(btrim(v_email));
  select role into v_role from public.team_members where team_id = v_team_id and user_id = v_user_id;
  if v_role is null then
    raise exception '% no pertenece al equipo %.', v_email, v_team_id;
  end if;
  if v_role = 'admin' and (select count(*) from public.team_members where team_id = v_team_id and role = 'admin') = 1 then
    raise exception 'Es el último administrador del equipo: añade otro administrador antes de retirarlo.';
  end if;

  for v_live in
    select opponent from public.matches
    where team_id = v_team_id and controller_user_id = v_user_id and status in ('setup', 'first_half', 'halftime', 'second_half')
  loop
    raise notice 'Aviso: controlaba el partido contra % (otro entrenador puede TOMAR CONTROL).', v_live.opponent;
  end loop;

  delete from public.team_members where team_id = v_team_id and user_id = v_user_id;
  raise notice '% retirado del equipo %.', v_email, v_team_id;
end;
$$;
