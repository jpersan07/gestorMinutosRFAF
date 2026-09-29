-- =============================================================================
-- SEED SOLO PARA DESARROLLO LOCAL (`supabase db reset` / primer `supabase start`).
-- `supabase db push` (producción) NO ejecuta este fichero.
--
-- Datos de prueba claramente marcados como DEMO: dos equipos para comprobar el
-- aislamiento entre equipos y cuentas de entrenador de prueba.
-- No hay jugadores ni partidos: se crean desde la app.
--
-- Cuentas (contraseña para todas: demo-local-2026):
--   isaac.demo@demo.local  → Equipo DEMO (admin)
--   jordi.demo@demo.local  → Equipo DEMO (coach)
--   jose.demo@demo.local   → Equipo DEMO (coach)
--   otro.demo@demo.local   → Otro equipo DEMO (admin)
-- =============================================================================

do $$
declare
  v_team uuid := '00000000-0000-4000-8000-0000000d0001';
  v_other_team uuid := '00000000-0000-4000-8000-0000000d0002';
  v_season uuid := '00000000-0000-4000-8000-0000000d0101';
  v_other_season uuid := '00000000-0000-4000-8000-0000000d0102';
  v_user record;
begin
  for v_user in
    select * from (values
      ('00000000-0000-4000-8000-0000000a0001'::uuid, 'isaac.demo@demo.local', 'ISAAC DEMO'),
      ('00000000-0000-4000-8000-0000000a0002'::uuid, 'jordi.demo@demo.local', 'JORDI DEMO'),
      ('00000000-0000-4000-8000-0000000a0003'::uuid, 'jose.demo@demo.local', 'JOSÉ DEMO'),
      ('00000000-0000-4000-8000-0000000a0004'::uuid, 'otro.demo@demo.local', 'OTRO DEMO')
    ) as u (id, email, display_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated', v_user.email,
      extensions.crypt('demo-local-2026', extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}',
      jsonb_build_object('display_name', v_user.display_name),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      v_user.id::text, v_user.id,
      jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;

  insert into public.teams (id, name) values
    (v_team, 'Equipo DEMO'),
    (v_other_team, 'Otro equipo DEMO');

  insert into public.seasons (id, team_id, name, starts_on, ends_on) values
    (v_season, v_team, '2026-27', '2026-07-01', '2027-06-30'),
    (v_other_season, v_other_team, '2026-27', '2026-07-01', '2027-06-30');

  update public.teams set current_season_id = v_season where id = v_team;
  update public.teams set current_season_id = v_other_season where id = v_other_team;

  insert into public.team_members (team_id, user_id, role) values
    (v_team, '00000000-0000-4000-8000-0000000a0001', 'admin'),
    (v_team, '00000000-0000-4000-8000-0000000a0002', 'coach'),
    (v_team, '00000000-0000-4000-8000-0000000a0003', 'coach'),
    (v_other_team, '00000000-0000-4000-8000-0000000a0004', 'admin');
end;
$$;
