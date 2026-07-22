-- ============================================================================
-- AUTH + RBAC + KPI OTOMATIS: fondasi skema (Tahap 1 dari rollout).
-- Migration ini murni ADDITIVE - tidak mengubah perilaku aplikasi sama sekali.
-- RLS TIDAK diaktifkan di sini (menyusul di migration terpisah setelah
-- login Edge Function & frontend sudah terpasang dan diuji).
-- Cara pakai: Supabase Dashboard > SQL Editor, tempel, Run.
-- ============================================================================

-- 1. Kolom baru di karyawan: pin_hash (bcrypt, menggantikan pin plaintext
--    setelah verifikasi berhasil) dan role (penanda untuk RLS - karyawan
--    selalu 'user', admin/super_admin punya tabel akun sendiri di bawah).
alter table public.karyawan
  add column if not exists pin_hash text,
  add column if not exists role text not null default 'user' check (role in ('user'));

-- 2. Akun admin & super_admin - BUKAN baris karyawan (kredensial & kolom beda:
--    username/password, bukan NIK/PIN/gaji/dept).
create table if not exists public.admin_accounts (
  id bigint generated always as identity primary key,
  username text not null unique,
  password_hash text not null,
  nama text not null,
  role text not null check (role in ('admin', 'super_admin')),
  is_active boolean not null default true,
  created_by bigint references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- 3. Tabel throttle percobaan login, untuk membatasi brute-force PIN/password.
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  identifier text not null,       -- nik (employee) atau username (admin)
  attempt_type text not null check (attempt_type in ('employee', 'admin')),
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_lookup
  on public.login_attempts (identifier, attempt_type, attempted_at desc);

-- 4. logs: tambah FK karyawan_id yang tidak bisa dipalsukan (dipakai RLS nanti
--    untuk "user cuma boleh insert/select log miliknya sendiri"). Nullable dulu,
--    di-backfill di Tahap 2 untuk data historis.
alter table public.logs
  add column if not exists karyawan_id bigint references public.karyawan(id);
create index if not exists idx_logs_karyawan_id on public.logs (karyawan_id);

-- 5. audit_logs: tambah identitas aktor sungguhan (bukan free-text tanpa
--    pemilik seperti sekarang). Diisi otomatis oleh trigger dari klaim JWT,
--    bukan dari input client (supaya tidak bisa dipalsukan).
alter table public.audit_logs
  add column if not exists actor_type text check (actor_type in ('admin', 'super_admin', 'user', 'system')),
  add column if not exists actor_id bigint,
  add column if not exists actor_name text;

create or replace function public.stamp_audit_actor()
returns trigger as $$
declare
  claims jsonb;
begin
  -- Catatan: klaim "role" DIRESERVE oleh PostgREST (nama Postgres role untuk
  -- SET ROLE, selalu 'authenticated' untuk token custom kita) - data role
  -- aplikasi ada di klaim terpisah "app_role", itu yang harus dibaca di sini.
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if claims is null or claims->>'app_role' is null then
    new.actor_type := 'system';
  else
    new.actor_type := claims->>'app_role';
    new.actor_name := claims->>'nama';
    new.actor_id := coalesce(
      nullif(claims->>'karyawan_id', '')::bigint,
      nullif(claims->>'admin_id', '')::bigint
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_stamp_audit_actor on public.audit_logs;
create trigger trg_stamp_audit_actor
  before insert on public.audit_logs
  for each row execute function public.stamp_audit_actor();

-- 6. kpi_snapshots: hasil hitung otomatis harian/mingguan/bulanan (diisi oleh
--    Edge Function terjadwal di Tahap 7), sumber cepat untuk dashboard supaya
--    tidak perlu hitung ulang dari tabel logs tiap kali dashboard dibuka.
create table if not exists public.kpi_snapshots (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.karyawan(id) on delete cascade,
  period_type text not null check (period_type in ('daily', 'weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  dept text,
  jabatan text,
  attendance_score numeric(5,2) not null,
  punctuality_score numeric(5,2) not null,
  manual_kpi_score numeric(5,2),
  final_score numeric(5,2) not null,
  final_grade text not null check (final_grade in ('A', 'B', 'C')),
  hadir int not null,
  telat int not null,
  total_hari_kerja int not null,
  computed_at timestamptz not null default now(),
  unique (employee_id, period_type, period_start)
);
create index if not exists idx_kpi_snapshots_period
  on public.kpi_snapshots (period_type, period_start);
create index if not exists idx_kpi_snapshots_dept_jabatan
  on public.kpi_snapshots (dept, jabatan, period_type, period_start);

-- Catatan:
-- - RLS masih OFF di semua tabel pada tahap ini - sengaja, supaya bisa diuji
--   bertahap tanpa risiko mengunci akses saat login/Edge Function belum siap.
-- - Setelah migration ini jalan, aplikasi harus tetap berfungsi 100% seperti
--   sebelumnya (tidak ada perilaku yang berubah).
