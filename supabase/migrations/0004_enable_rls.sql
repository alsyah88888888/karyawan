-- ============================================================================
-- AKTIFKAN RLS (Tahap 5-6 rollout): dijalankan BERTAHAP per tabel oleh
-- implementer, bukan sekaligus - urutan dari paling aman ke paling berisiko:
-- audit_logs -> performance_reviews -> leave_requests -> logs -> karyawan
-- -> admin_accounts -> kpi_snapshots -> login_attempts -> storage buckets.
-- Tes login admin, login karyawan, dan absen kiosk (anonim) setelah tiap
-- bagian - kalau ada yang rusak, cukup jalankan:
--   alter table public.<nama_tabel> disable row level security;
-- untuk rollback SATU tabel itu saja tanpa mempengaruhi yang lain.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_logs - paling aman, tidak ada yang bergantung membacanya secara luas
-- ---------------------------------------------------------------------------
alter table public.audit_logs enable row level security;

drop policy if exists "super_admin reads audit log" on public.audit_logs;
create policy "super_admin reads audit log"
on public.audit_logs for select
using ( (auth.jwt()->>'app_role') = 'super_admin' );

drop policy if exists "admin inserts audit log" on public.audit_logs;
create policy "admin inserts audit log"
on public.audit_logs for insert
with check ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );
-- Tidak ada policy update/delete untuk siapapun -> audit log tidak bisa diubah/dihapus.

-- ---------------------------------------------------------------------------
-- 2. performance_reviews
-- ---------------------------------------------------------------------------
alter table public.performance_reviews enable row level security;

drop policy if exists "admin manages performance reviews" on public.performance_reviews;
create policy "admin manages performance reviews"
on public.performance_reviews for all
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') )
with check ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

drop policy if exists "user reads own performance reviews" on public.performance_reviews;
create policy "user reads own performance reviews"
on public.performance_reviews for select
using ( employee_id = (auth.jwt()->>'karyawan_id')::bigint );

-- ---------------------------------------------------------------------------
-- 3. leave_requests
-- ---------------------------------------------------------------------------
alter table public.leave_requests enable row level security;

drop policy if exists "admin manages leave requests" on public.leave_requests;
create policy "admin manages leave requests"
on public.leave_requests for all
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') )
with check ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

drop policy if exists "user reads own leave requests" on public.leave_requests;
create policy "user reads own leave requests"
on public.leave_requests for select
using ( employee_id = (auth.jwt()->>'karyawan_id')::bigint );

drop policy if exists "user inserts own leave requests" on public.leave_requests;
create policy "user inserts own leave requests"
on public.leave_requests for insert
with check ( employee_id = (auth.jwt()->>'karyawan_id')::bigint );

drop policy if exists "user updates own pending leave requests" on public.leave_requests;
create policy "user updates own pending leave requests"
on public.leave_requests for update
using ( employee_id = (auth.jwt()->>'karyawan_id')::bigint and status = 'PENDING' )
with check ( employee_id = (auth.jwt()->>'karyawan_id')::bigint );

drop policy if exists "user deletes own pending leave requests" on public.leave_requests;
create policy "user deletes own pending leave requests"
on public.leave_requests for delete
using ( employee_id = (auth.jwt()->>'karyawan_id')::bigint and status = 'PENDING' );

-- ---------------------------------------------------------------------------
-- 4. logs - kiosk (index.html) TETAP anonim & tanpa login by design, jadi
--    insert-nya harus tetap terbuka untuk request tanpa token sama sekali.
-- ---------------------------------------------------------------------------
alter table public.logs enable row level security;

drop policy if exists "admin manages logs" on public.logs;
create policy "admin manages logs"
on public.logs for all
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') )
with check ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

-- Kiosk (anon) JUGA perlu baca logs untuk cek "sudah absen hari ini belum"
-- sebelum insert - logs tidak memuat data sepenuly gaji/PIN, jadi dibolehkan.
drop policy if exists "user reads own logs" on public.logs;
create policy "user reads own logs"
on public.logs for select
using ( (auth.jwt()->>'app_role') is null or karyawan_id = (auth.jwt()->>'karyawan_id')::bigint );

drop policy if exists "kiosk and user insert logs" on public.logs;
create policy "kiosk and user insert logs"
on public.logs for insert
with check (
  (auth.jwt()->>'app_role') is null  -- kiosk anonim, tidak ada token custom sama sekali
  or karyawan_id = (auth.jwt()->>'karyawan_id')::bigint
);

-- ---------------------------------------------------------------------------
-- 5. karyawan - paling berisiko (paling banyak dipakai). View karyawan_public
--    dibuat supaya kiosk (anonim) tetap bisa isi dropdown nama tanpa perlu
--    baca kolom sensitif (gaji, pin_hash, rekening, npwp, pinjaman, dst).
-- ---------------------------------------------------------------------------
create or replace view public.karyawan_public as
select id, nama, dept, jabatan, foto_url
from public.karyawan;

grant select on public.karyawan_public to anon, authenticated;

alter table public.karyawan enable row level security;

drop policy if exists "admin manages karyawan" on public.karyawan;
create policy "admin manages karyawan"
on public.karyawan for all
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') )
with check ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

drop policy if exists "user reads own karyawan row" on public.karyawan;
create policy "user reads own karyawan row"
on public.karyawan for select
using ( id = (auth.jwt()->>'karyawan_id')::bigint );

-- ---------------------------------------------------------------------------
-- 6. admin_accounts - hanya super_admin yang kelola; admin lihat profil sendiri
-- ---------------------------------------------------------------------------
alter table public.admin_accounts enable row level security;

drop policy if exists "super_admin manages admin accounts" on public.admin_accounts;
create policy "super_admin manages admin accounts"
on public.admin_accounts for all
using ( (auth.jwt()->>'app_role') = 'super_admin' )
with check ( (auth.jwt()->>'app_role') = 'super_admin' );

drop policy if exists "admin reads own account" on public.admin_accounts;
create policy "admin reads own account"
on public.admin_accounts for select
using ( id = (auth.jwt()->>'admin_id')::bigint );

-- ---------------------------------------------------------------------------
-- 7. kpi_snapshots - dibaca dashboard, ditulis HANYA oleh Edge Function cron
--    (pakai service_role, otomatis bypass RLS - makanya tidak perlu policy insert)
-- ---------------------------------------------------------------------------
alter table public.kpi_snapshots enable row level security;

drop policy if exists "admin reads all kpi snapshots" on public.kpi_snapshots;
create policy "admin reads all kpi snapshots"
on public.kpi_snapshots for select
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

drop policy if exists "user reads own kpi snapshots" on public.kpi_snapshots;
create policy "user reads own kpi snapshots"
on public.kpi_snapshots for select
using ( employee_id = (auth.jwt()->>'karyawan_id')::bigint );

-- ---------------------------------------------------------------------------
-- 8. login_attempts - tidak ada policy sama sekali = tertutup total untuk
--    anon/authenticated, hanya Edge Function (service_role) yang bisa akses.
-- ---------------------------------------------------------------------------
alter table public.login_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- 9. Storage buckets: perketat upload jadi admin/super_admin only. Bucket
--    tetap public=true supaya link gambar (dipakai wa-gateway/Fonnte, yang
--    tidak bisa kirim token Supabase) tetap bisa dibaca browser/HTTP biasa.
-- ---------------------------------------------------------------------------
drop policy if exists "Public can upload slip gaji" on storage.objects;
create policy "Admin uploads slip gaji"
on storage.objects for insert
to public
with check ( bucket_id = 'slip-gaji' and (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

drop policy if exists "Public can upload foto karyawan" on storage.objects;
drop policy if exists "Public can update foto karyawan" on storage.objects;
create policy "Admin uploads foto karyawan"
on storage.objects for insert
to public
with check ( bucket_id = 'foto-karyawan' and (auth.jwt()->>'app_role') in ('admin', 'super_admin') );
create policy "Admin updates foto karyawan"
on storage.objects for update
to public
using ( bucket_id = 'foto-karyawan' and (auth.jwt()->>'app_role') in ('admin', 'super_admin') );
-- Policy "Public can read slip gaji" / "Public can read foto karyawan" dari
-- migration 0001/0002 TETAP dipertahankan (tidak di-drop) - baca publik masih perlu.
