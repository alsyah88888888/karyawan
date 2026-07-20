// Edge Function: send-attendance-reminder
// Dipanggil oleh pg_cron tiap hari jam 10:00 WIB (lihat supabase/migrations/0001_wa_automation.sql).
// Mengecek siapa saja karyawan yang belum presensi MASUK / DINAS LUAR hari ini,
// lalu mengirim pesan pengingat via Fonnte ke nomor WA masing-masing.
//
// Deploy: supabase functions deploy send-attendance-reminder --no-verify-jwt
//   (--no-verify-jwt supaya bisa dipanggil pg_cron. Karena itu function ini
//    TIDAK memakai Supabase JWT sama sekali untuk otorisasi - sebagai gantinya
//    setiap request wajib membawa header x-cron-secret yang cocok dengan
//    secret CRON_SECRET, supaya endpoint publiknya tidak bisa dipicu sembarang
//    orang. Jauh lebih aman daripada menaruh service_role key di cron job.)
// Secret : supabase secrets set FONNTE_TOKEN=xxxxxxxxxxxx
//          supabase secrets set CRON_SECRET=xxxxxxxxxxxx
//          (SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY otomatis tersedia di Edge Functions)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FONNTE_TOKEN = Deno.env.get("FONNTE_TOKEN")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

// Tanggal "hari ini" menurut WIB (UTC+7), dalam format YYYY-MM-DD
function tanggalHariIniWIB(): string {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const tanggal = tanggalHariIniWIB();

  const { data: karyawan, error: errKar } = await supabase
    .from("karyawan")
    .select("nama, nomor_wa")
    .not("nomor_wa", "is", null)
    .neq("nomor_wa", "");
  if (errKar) {
    return new Response(JSON.stringify({ error: errKar.message }), { status: 500 });
  }

  const startUtc = new Date(`${tanggal}T00:00:00+07:00`).toISOString();
  const endUtc = new Date(`${tanggal}T23:59:59+07:00`).toISOString();

  // Presensi masuk dianggap sah kalau status diawali "MASUK" atau "DINAS LUAR"
  // (lihat script.js prosesAbsen: dua tombol itu yang menandai jam masuk kerja)
  const { data: logsHariIni, error: errLog } = await supabase
    .from("logs")
    .select("nama, status, waktu")
    .gte("waktu", startUtc)
    .lte("waktu", endUtc)
    .or("status.ilike.MASUK%,status.ilike.DINAS LUAR%");
  if (errLog) {
    return new Response(JSON.stringify({ error: errLog.message }), { status: 500 });
  }

  const sudahMasuk = new Set((logsHariIni || []).map((l) => l.nama));
  const belumMasuk = (karyawan || []).filter((k) => k.nomor_wa && !sudahMasuk.has(k.nama));

  const hasil: Array<{ nama: string; status: string; detail?: unknown }> = [];

  for (const k of belumMasuk) {
    // Dedup: kalau sudah pernah tercatat terkirim hari ini, skip.
    // insert akan gagal karena unique(nama, tanggal) kalau baris sudah ada.
    const { error: dupErr } = await supabase
      .from("reminder_log")
      .insert({ nama: k.nama, tanggal });
    if (dupErr) {
      hasil.push({ nama: k.nama, status: "skip-sudah-dikirim" });
      continue;
    }

    const pesan =
      `Halo *${k.nama}*,\n\n` +
      `Sampai jam 10:00 WIB hari ini Anda *belum melakukan presensi masuk*.\n` +
      `Mohon segera lakukan presensi di aplikasi, atau hubungi atasan Anda bila ada kendala.\n\n` +
      `_Pesan otomatis - HRIS KOBOI_`;

    const form = new URLSearchParams();
    form.set("target", k.nomor_wa);
    form.set("message", pesan);
    form.set("countryCode", "62");

    try {
      const waRes = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { Authorization: FONNTE_TOKEN },
        body: form,
      });
      const waJson = await waRes.json();
      hasil.push({ nama: k.nama, status: waJson?.status === false ? "gagal" : "terkirim", detail: waJson });
    } catch (e) {
      hasil.push({ nama: k.nama, status: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(
    JSON.stringify({ tanggal, totalKaryawan: karyawan?.length || 0, totalBelumMasuk: belumMasuk.length, hasil }),
    { headers: { "Content-Type": "application/json" } }
  );
});
