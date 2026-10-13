-- Migration 0015: Multi-Company Architecture (KBI, FRZ, Mitra Belanja)
-- Memisahkan entitas perusahaan: PT. Kola Borasi Indonesia, PT. Fortune Reef Zona, dan Mitra Belanja.

-- 1. Tambah kolom perusahaan pada tabel karyawan
alter table public.karyawan
  add column if not exists perusahaan text default 'PT. Kola Borasi Indonesia';

-- 2. Perbarui view karyawan_public agar kolom perusahaan dapat dibaca
create or replace view public.karyawan_public as
select id, nama, dept, jabatan, foto_url, perusahaan
from public.karyawan;

grant select on public.karyawan_public to anon, authenticated;

-- 3. Tambah kolom company_access pada tabel admin_accounts (menentukan akses admin ke PT tertentu atau ALL)
alter table public.admin_accounts
  add column if not exists company_access text default 'ALL';

-- 4. Backfill data perusahaan karyawan
update public.karyawan
set perusahaan = 'PT. Fortune Reef Zona'
where nik like 'FRZ-%' 
   or nama in ('LUTVI ABDULAH', 'SELI MARYANI', 'JOSAFAT TEGUH IMAN SINAGA');

update public.karyawan
set perusahaan = 'Mitra Belanja'
where nik like 'MB-%';

update public.karyawan
set perusahaan = 'PT. Kola Borasi Indonesia'
where perusahaan is null or perusahaan = '';

-- 5. Perbarui fungsi admin_create_account agar dapat menetapkan company_access
create or replace function public.admin_create_account(
  p_username text,
  p_password text,
  p_nama text,
  p_role text,
  p_company_access text default 'ALL'
) returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_role text := auth.jwt()->>'app_role';
  v_caller_id bigint := (auth.jwt()->>'admin_id')::bigint;
  v_new_id bigint;
begin
  if v_caller_role <> 'super_admin' then
    raise exception 'Hanya super_admin yang boleh membuat akun admin baru';
  end if;
  if p_role not in ('admin', 'super_admin') then
    raise exception 'Role tidak valid';
  end if;

  insert into public.admin_accounts (username, password_hash, nama, role, company_access, created_by)
  values (p_username, extensions.crypt(p_password, extensions.gen_salt('bf')), p_nama, p_role, coalesce(p_company_access, 'ALL'), v_caller_id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.admin_create_account(text, text, text, text, text) to authenticated;
