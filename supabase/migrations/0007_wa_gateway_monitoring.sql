-- ============================================================================
-- MONITORING WA-GATEWAY: cek kesehatan tiap beberapa jam, alert via Fonnte
-- kalau bermasalah (jalur terpisah dari wa-gateway sendiri).
-- Cara pakai: Supabase Dashboard > SQL Editor, tempel, GANTI <CRON_SECRET>
-- dengan nilai yang sama persis dengan `supabase secrets set CRON_SECRET=...`.
-- ============================================================================

create table if not exists public.wa_gateway_health_log (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  ready boolean not null,
  error_detail text
);
create index if not exists idx_wa_health_checked_at on public.wa_gateway_health_log (checked_at desc);

create table if not exists public.wa_gateway_alerts (
  id bigint generated always as identity primary key,
  sent_at timestamptz not null default now()
);

alter table public.wa_gateway_health_log enable row level security;
alter table public.wa_gateway_alerts enable row level security;

drop policy if exists "admin reads wa health log" on public.wa_gateway_health_log;
create policy "admin reads wa health log"
on public.wa_gateway_health_log for select
using ( (auth.jwt()->>'app_role') in ('admin', 'super_admin') );

-- Cek tiap 3 jam (menit ke-5): 05:05, 08:05, 11:05, 14:05, 17:05, 20:05, 23:05, 02:05 WIB
do $$
begin
  if exists (select 1 from cron.job where jobname = 'monitor-wa-gateway') then
    perform cron.unschedule('monitor-wa-gateway');
  end if;
end $$;

select cron.schedule(
  'monitor-wa-gateway',
  '5 */3 * * *',
  $$
  select net.http_post(
    url := 'https://ulmwpmzcaiuyubgehptt.supabase.co/functions/v1/monitor-wa-gateway',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
