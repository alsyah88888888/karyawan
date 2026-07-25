-- ============================================================================
-- REMINDER PRESENSI PULANG: kirim WA jam 23:00 WIB ke karyawan yang sudah
-- presensi MASUK/DINAS LUAR hari ini tapi belum presensi PULANG - supaya
-- tidak lupa (jam kerja tidak akan terhitung ke payroll kalau presensi
-- pulang tidak dilakukan). Dikecualikan: FERZA FARIZ (shift-nya memang
-- wajar masih berjalan lewat jam segitu, atas permintaan user).
--
-- reminder_log sebelumnya cuma dipakai reminder MASUK (unique per nama+
-- tanggal) - ditambah kolom jenis supaya reminder PULANG punya slot dedup
-- sendiri, tidak bentrok/ke-skip oleh entri reminder MASUK di hari yang sama.
-- ============================================================================

alter table public.reminder_log
  add column if not exists jenis text not null default 'masuk';

alter table public.reminder_log
  drop constraint if exists reminder_log_nama_tanggal_key;

alter table public.reminder_log
  add constraint reminder_log_nama_tanggal_jenis_key unique (nama, tanggal, jenis);

-- Cron: tiap hari jam 23:00 WIB = 16:00 UTC
select cron.schedule(
  'reminder-presensi-pulang-2300',
  '0 16 * * *',
  $$
  select net.http_post(
    url := 'https://ulmwpmzcaiuyubgehptt.supabase.co/functions/v1/send-checkout-reminder',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
