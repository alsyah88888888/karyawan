-- ============================================================================
-- HARI LIBUR sebagai satu sumber data di database (sebelumnya cuma array JS
-- hardcoded DAFTAR_LIBUR di admin.js, cuma dipakai tampilan Kalender & tidak
-- bisa diakses Edge Function). Dipindah ke tabel supaya kedua reminder WA
-- (masuk 09:30 & pulang 23:00) bisa skip otomatis di hari libur, dan tampilan
-- Kalender & Libur tetap baca dari sumber yang sama (bukan dua data terpisah
-- yang bisa beda-beda).
-- ============================================================================

create table if not exists public.holidays (
  tgl date primary key,
  nama text not null
);

insert into public.holidays (tgl, nama) values
  ('2026-01-01', 'Tahun Baru 2026'),
  ('2026-01-29', 'Tahun Baru Imlek'),
  ('2026-02-18', 'Isra Mi''raj'),
  ('2026-03-20', 'Hari Raya Nyepi'),
  ('2026-03-25', 'Idul Fitri 1447 H'),
  ('2026-03-26', 'Cuti Bersama Idul Fitri'),
  ('2026-04-03', 'Wafat Yesus Kristus'),
  ('2026-05-01', 'Hari Buruh Internasional'),
  ('2026-05-14', 'Kenaikan Yesus Kristus'),
  ('2026-05-27', 'Hari Raya Waisak'),
  ('2026-06-01', 'Hari Lahir Pancasila'),
  ('2026-08-17', 'Hari Kemerdekaan RI'),
  ('2026-12-25', 'Hari Raya Natal')
on conflict (tgl) do nothing;

alter table public.holidays enable row level security;

drop policy if exists "admin reads holidays" on public.holidays;
create policy "admin reads holidays"
on public.holidays for select
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

drop policy if exists "admin manages holidays" on public.holidays;
create policy "admin manages holidays"
on public.holidays for all
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') )
with check ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );
