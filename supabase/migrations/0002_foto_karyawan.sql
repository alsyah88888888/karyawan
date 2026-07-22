-- ============================================================================
-- FOTO KARYAWAN: upload foto lewat form admin, disimpan di Supabase Storage.
-- Cara pakai: buka Supabase Dashboard > SQL Editor, tempel isi file ini, Run.
-- ============================================================================

alter table public.karyawan
  add column if not exists foto_url text;

insert into storage.buckets (id, name, public)
values ('foto-karyawan', 'foto-karyawan', true)
on conflict (id) do nothing;

drop policy if exists "Public can upload foto karyawan" on storage.objects;
create policy "Public can upload foto karyawan"
on storage.objects for insert
to public
with check (bucket_id = 'foto-karyawan');

drop policy if exists "Public can read foto karyawan" on storage.objects;
create policy "Public can read foto karyawan"
on storage.objects for select
to public
using (bucket_id = 'foto-karyawan');

drop policy if exists "Public can update foto karyawan" on storage.objects;
create policy "Public can update foto karyawan"
on storage.objects for update
to public
using (bucket_id = 'foto-karyawan');
