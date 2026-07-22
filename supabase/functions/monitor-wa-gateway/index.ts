// Edge Function: monitor-wa-gateway
// Dipanggil pg_cron tiap beberapa jam - cek apakah wa-gateway self-hosted
// (VPS, Baileys) masih hidup DAN masih terhubung ke WhatsApp (bukan cuma
// server-nya nyala, tapi sesi WA-nya juga harus "ready"). Kalau tidak,
// kirim peringatan via Fonnte (jalur terpisah dari wa-gateway, jadi tetap
// bisa mengingatkan walau wa-gateway sendiri yang sedang bermasalah).
//
// Kenapa ini perlu: wa-gateway pernah ter-logout diam-diam (linked device
// kelepas / sesi korup) tanpa proses PM2-nya ikut mati - dari luar terlihat
// "online" padahal tidak benar-benar mengirim apapun, sampai ada yang sadar
// saat menguji manual.
//
// Deploy: supabase functions deploy monitor-wa-gateway --no-verify-jwt
// Secret : supabase secrets set ALERT_PHONE=628xxxxxxxxxx
//          (WA_GATEWAY_URL, FONNTE_TOKEN, CRON_SECRET sudah ada dari fitur lain)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_GATEWAY_URL = Deno.env.get("WA_GATEWAY_URL")!;
const FONNTE_TOKEN = Deno.env.get("FONNTE_TOKEN")!;
const ALERT_PHONE = Deno.env.get("ALERT_PHONE")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const ALERT_COOLDOWN_HOURS = 3;

async function kirimAlertFonnte(pesan: string) {
  const form = new URLSearchParams();
  form.set("target", ALERT_PHONE);
  form.set("message", pesan);
  form.set("countryCode", "62");
  await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: FONNTE_TOKEN },
    body: form,
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let ready = false;
  let errorDetail = "";
  try {
    const res = await fetch(`${WA_GATEWAY_URL}/health`, { signal: AbortSignal.timeout(10000) });
    const json = await res.json();
    ready = json?.ready === true;
    if (!ready) errorDetail = "wa-gateway merespons tapi sesi WhatsApp belum siap (ready:false)";
  } catch (e) {
    errorDetail = e instanceof Error ? e.message : String(e);
  }

  await supabase.from("wa_gateway_health_log").insert({ ready, error_detail: errorDetail || null });

  if (!ready) {
    const cooldownSejak = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("wa_gateway_alerts")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", cooldownSejak);

    if ((count || 0) === 0) {
      await kirimAlertFonnte(
        `⚠️ *PERINGATAN SISTEM*\n\nwa-gateway (WhatsApp otomatis untuk slip gaji & reminder presensi) sedang BERMASALAH.\n\nDetail: ${errorDetail}\n\nMohon cek VPS: pm2 logs wa-gateway. Kemungkinan perlu scan ulang QR (sesi WhatsApp ter-logout).\n\n_Pesan otomatis - HRIS KOBOI Monitoring_`
      );
      await supabase.from("wa_gateway_alerts").insert({});
    }
  }

  return new Response(JSON.stringify({ ready, errorDetail }), {
    headers: { "Content-Type": "application/json" },
  });
});
