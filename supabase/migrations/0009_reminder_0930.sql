-- ============================================================================
-- GESER JADWAL REMINDER PRESENSI: 10:00 WIB -> 09:30 WIB.
-- Cara pakai: Supabase Dashboard > SQL Editor, tempel, GANTI <CRON_SECRET>
-- dengan nilai yang sama persis dengan `supabase secrets set CRON_SECRET=...`,
-- lalu Run. JANGAN commit versi file ini yang sudah berisi nilai asli ke git.
-- ============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reminder-presensi-10am') then
    perform cron.unschedule('reminder-presensi-10am');
  end if;
  if exists (select 1 from cron.job where jobname = 'reminder-presensi-0930') then
    perform cron.unschedule('reminder-presensi-0930');
  end if;
end $$;

-- Senin-Sabtu jam 09:30 WIB = 02:30 UTC
select cron.schedule(
  'reminder-presensi-0930',
  '30 2 * * 1-6',
  $$
  select net.http_post(
    url := 'https://ulmwpmzcaiuyubgehptt.supabase.co/functions/v1/send-attendance-reminder',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
