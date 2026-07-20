-- ============================================================================
-- WA AUTOMATION: kirim slip gaji otomatis + reminder presensi jam 10:00 WIB
-- Cara pakai: buka Supabase Dashboard > SQL Editor, tempel isi file ini,
-- GANTI placeholder <SERVICE_ROLE_KEY> di bagian paling bawah, lalu Run.
-- Project ref sudah terisi otomatis: ulmwpmzcaiuyubgehptt (dari script.js).
-- ============================================================================

-- 1. Tabel dedup: mencegah reminder terkirim dobel kalau cron sempat retry
create table if not exists public.reminder_log (
  id bigint generated always as identity primary key,
  nama text not null,
  tanggal date not null,
  terkirim_at timestamptz not null default now(),
  unique (nama, tanggal)
);

-- 2. Bucket storage untuk gambar slip gaji yang dikirim ke Fonnte (perlu URL publik)
insert into storage.buckets (id, name, public)
values ('slip-gaji', 'slip-gaji', true)
on conflict (id) do nothing;

-- Bucket "public" hanya membebaskan RLS untuk pembacaan (download). Upload
-- (dari admin.js pakai anon key, sama seperti tabel karyawan/logs di app ini)
-- tetap butuh policy eksplisit ini.
drop policy if exists "Public can upload slip gaji" on storage.objects;
create policy "Public can upload slip gaji"
on storage.objects for insert
to public
with check (bucket_id = 'slip-gaji');

drop policy if exists "Public can read slip gaji" on storage.objects;
create policy "Public can read slip gaji"
on storage.objects for select
to public
using (bucket_id = 'slip-gaji');

-- 3. Extension untuk menjalankan cron job & memanggil Edge Function via HTTP
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 4. Jadwal: tiap hari Senin-Sabtu jam 03:00 UTC = 10:00 WIB
--    (hapus dulu kalau sebelumnya pernah dibuat, supaya tidak dobel saat re-run)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'reminder-presensi-10am') then
    perform cron.unschedule('reminder-presensi-10am');
  end if;
end $$;

select cron.schedule(
  'reminder-presensi-10am',
  '0 3 * * 1-6',
  $$
  select net.http_post(
    url := 'https://ulmwpmzcaiuyubgehptt.supabase.co/functions/v1/send-attendance-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Catatan:
-- - <SERVICE_ROLE_KEY> ambil dari Dashboard > Project Settings > API > service_role key.
--   JANGAN commit key ini ke git. Isi langsung di SQL Editor saat menjalankan query.
-- - Jadwal Senin-Sabtu (1-6). Ubah ke "* * * * *" range sesuai hari kerja perusahaan bila perlu.
-- - Untuk cek histori jalannya cron: select * from cron.job_run_details order by start_time desc limit 20;
