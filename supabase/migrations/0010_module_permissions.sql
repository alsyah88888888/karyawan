-- ============================================================================
-- IZIN MODUL PER ROLE: Super Admin bisa menyalakan/mematikan akses modul
-- tertentu untuk role "admin" (super_admin selalu full access, tidak bisa
-- dibatasi). Ditegakkan sampai ke RLS/trigger di database, bukan cuma
-- sembunyikan tab di sidebar - jadi walau admin yang dibatasi coba akses
-- lewat console/API langsung, tetap ditolak database.
--
-- Modul yang bisa dibatasi HANYA yang datanya independen (leave_requests,
-- performance_reviews/kpi_snapshots, kolom insentif di karyawan). Modul
-- Dashboard/Log Absensi/Karyawan/Kalender SENGAJA tidak dibuat toggle-able
-- di level RLS karena sama-sama membaca tabel karyawan/logs yang juga
-- dipakai modul lain - membatasinya di RLS akan ikut merusak modul lain
-- yang butuh tabel yang sama. Manajemen Admin & Audit Log sudah exclusive
-- super_admin sejak 0003/0004, tidak perlu toggle tambahan.
-- ============================================================================

create table if not exists public.admin_module_settings (
  module_key text primary key,
  label text not null,
  enabled_for_admin boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by bigint references public.admin_accounts(id)
);

insert into public.admin_module_settings (module_key, label) values
  ('leave_management', 'Manajemen Cuti'),
  ('performance_kpi', 'Performa (KPI)'),
  ('ceo_access', 'CEO Access (Approval Insentif)')
on conflict (module_key) do nothing;

alter table public.admin_module_settings enable row level security;

-- admin & super_admin sama-sama boleh BACA (dipakai buat render sidebar
-- sendiri), tapi cuma super_admin yang boleh UBAH (policy "for all" di bawah
-- tidak menutupi select untuk role admin karena sudah ada policy select
-- terpisah yang permisif).
drop policy if exists "admin reads module settings" on public.admin_module_settings;
create policy "admin reads module settings"
on public.admin_module_settings for select
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

drop policy if exists "super_admin manages module settings" on public.admin_module_settings;
create policy "super_admin manages module settings"
on public.admin_module_settings for all
using ( (auth.jwt()->>'app_role') = 'super_admin' )
with check ( (auth.jwt()->>'app_role') = 'super_admin' );

-- Helper dipanggil dari policy tabel lain - security definer supaya bisa
-- baca admin_module_settings terlepas dari siapa pemanggilnya (menghindari
-- kebutuhan re-grant select per role di tiap tabel yang memanggilnya).
create or replace function public.admin_module_enabled(key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled_for_admin from public.admin_module_settings where module_key = key),
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- Modul "Performa (KPI)": performance_reviews (baca+tulis admin) & kpi_snapshots (baca admin)
-- ---------------------------------------------------------------------------
drop policy if exists "admin manages performance reviews" on public.performance_reviews;
create policy "admin manages performance reviews"
on public.performance_reviews for all
using (
  (auth.jwt()->>'app_role') = 'super_admin'
  or ( (auth.jwt()->>'app_role') = 'admin' and public.admin_module_enabled('performance_kpi') )
)
with check (
  (auth.jwt()->>'app_role') = 'super_admin'
  or ( (auth.jwt()->>'app_role') = 'admin' and public.admin_module_enabled('performance_kpi') )
);

drop policy if exists "admin reads all kpi snapshots" on public.kpi_snapshots;
create policy "admin reads all kpi snapshots"
on public.kpi_snapshots for select
using (
  (auth.jwt()->>'app_role') = 'super_admin'
  or ( (auth.jwt()->>'app_role') = 'admin' and public.admin_module_enabled('performance_kpi') )
);

-- ---------------------------------------------------------------------------
-- Modul "Manajemen Cuti": leave_requests (baca+tulis admin - policy user
-- pemilik cuti sendiri di 0004 TIDAK diubah, tetap bisa ajukan cuti sendiri)
-- ---------------------------------------------------------------------------
drop policy if exists "admin manages leave requests" on public.leave_requests;
create policy "admin manages leave requests"
on public.leave_requests for all
using (
  (auth.jwt()->>'app_role') = 'super_admin'
  or ( (auth.jwt()->>'app_role') = 'admin' and public.admin_module_enabled('leave_management') )
)
with check (
  (auth.jwt()->>'app_role') = 'super_admin'
  or ( (auth.jwt()->>'app_role') = 'admin' and public.admin_module_enabled('leave_management') )
);

-- ---------------------------------------------------------------------------
-- Modul "CEO Access": bukan tabel terpisah, cuma 2 kolom approval insentif
-- di karyawan (is_incentive_approved, incentive_approved_val). Trigger di
-- bawah HANYA menolak perubahan 2 kolom ini kalau modul dimatikan untuk
-- admin - kolom lain di karyawan (nama, gaji pokok, dept, dst, milik modul
-- "Karyawan") tetap bisa diubah admin seperti biasa, tidak ikut terkunci.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_ceo_access_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role text := auth.jwt()->>'app_role';
begin
  if role = 'super_admin' then
    return new;
  end if;

  if (new.is_incentive_approved is distinct from old.is_incentive_approved)
     or (new.incentive_approved_val is distinct from old.incentive_approved_val) then
    if role != 'admin' or not public.admin_module_enabled('ceo_access') then
      raise exception 'Modul CEO Access dinonaktifkan untuk akun ini';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_ceo_access on public.karyawan;
create trigger trg_enforce_ceo_access
before update on public.karyawan
for each row execute function public.enforce_ceo_access_permission();
