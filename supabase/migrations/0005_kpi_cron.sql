-- ============================================================================
-- KPI OTOMATIS: jadwal cron harian/mingguan/bulanan untuk compute-kpi-snapshots.
-- Cara pakai: buka Supabase Dashboard > SQL Editor, tempel isi file ini,
-- GANTI placeholder <KPI_CRON_SECRET> dengan nilai yang SAMA PERSIS dengan
-- yang di-set lewat `supabase secrets set KPI_CRON_SECRET=...`, lalu Run.
-- JANGAN commit versi file ini yang sudah berisi nilai asli ke git.
-- ============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kpi-snapshot-daily') then
    perform cron.unschedule('kpi-snapshot-daily');
  end if;
  if exists (select 1 from cron.job where jobname = 'kpi-snapshot-weekly') then
    perform cron.unschedule('kpi-snapshot-weekly');
  end if;
  if exists (select 1 from cron.job where jobname = 'kpi-snapshot-monthly') then
    perform cron.unschedule('kpi-snapshot-monthly');
  end if;
end $$;

-- Harian: tiap hari jam 23:50 WIB = 16:50 UTC
select cron.schedule(
  'kpi-snapshot-daily',
  '50 16 * * *',
  $$
  select net.http_post(
    url := 'https://ulmwpmzcaiuyubgehptt.supabase.co/functions/v1/compute-kpi-snapshots',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<KPI_CRON_SECRET>'),
    body := '{"periodType":"daily"}'::jsonb
  );
  $$
);

-- Mingguan: tiap Senin jam 00:10 WIB = Minggu 17:10 UTC
select cron.schedule(
  'kpi-snapshot-weekly',
  '10 17 * * 0',
  $$
  select net.http_post(
    url := 'https://ulmwpmzcaiuyubgehptt.supabase.co/functions/v1/compute-kpi-snapshots',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<KPI_CRON_SECRET>'),
    body := '{"periodType":"weekly"}'::jsonb
  );
  $$
);

-- Bulanan: tanggal 1 jam 00:20 WIB = tanggal terakhir bulan sebelumnya 17:20 UTC
select cron.schedule(
  'kpi-snapshot-monthly',
  '20 17 28-31 * *',
  $$
  select
    case when (extract(day from ((now() at time zone 'Asia/Jakarta') + interval '1 day')) = 1) then
      net.http_post(
        url := 'https://ulmwpmzcaiuyubgehptt.supabase.co/functions/v1/compute-kpi-snapshots',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<KPI_CRON_SECRET>'),
        body := '{"periodType":"monthly"}'::jsonb
      )
    else null end;
  $$
);

-- Catatan:
-- - <KPI_CRON_SECRET> BUKAN service_role key, cuma bisa memicu function ini saja.
-- - Cron bulanan dijadwalkan tanggal 28-31 tiap jam yang sama, tapi function
--   HANYA benar-benar dipanggil kalau besok adalah tanggal 1 (dicek via SQL
--   di dalam job) - supaya jalan tepat di hari terakhir bulan apapun jumlah
--   harinya (28/29/30/31) tanpa perlu 12 jadwal cron berbeda per bulan.
