-- =============================================================================
-- Gestor de Minutos · 4/4 · Escudos en Supabase Storage
--
-- Bucket PRIVADO "crests". Cada equipo tiene su carpeta: <team_id>/<crest_id>.<ext>.
-- PostgreSQL (public.crests) guarda la ruta y los metadatos; la imagen está aquí.
-- Solo los miembros del equipo pueden subir y leer los escudos de su carpeta.
-- Los escudos son inmutables: no hay políticas de update ni delete.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crests', 'crests', false, 262144, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "crests_objects_select_members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'crests'
    and (storage.foldername(name))[1] in (select t::text from private.user_team_ids() as t)
  );

create policy "crests_objects_insert_members" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'crests'
    and (storage.foldername(name))[1] in (select t::text from private.user_team_ids() as t)
  );
