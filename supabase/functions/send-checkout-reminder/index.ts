// Edge Function: send-checkout-reminder
// Dipanggil pg_cron tiap hari jam 23:00 WIB (lihat
// supabase/migrations/0011_checkout_reminder.sql). Mengecek siapa saja
// karyawan yang sudah presensi MASUK/DINAS LUAR hari ini tapi BELUM presensi
// PULANG, lalu kirim reminder formal via wa-gateway - supaya jam kerja tidak
// gagal terhitung ke payroll gara-gara lupa presensi pulang.
//
// FERZA FARIZ dikecualikan dari reminder ini (shift-nya memang wajar masih
// berjalan lewat jam segitu, atas permintaan eksplisit user - lihat riwayat
// percakapan, bukan bug kalau namanya tidak pernah dapat reminder ini).
//
// Deploy: supabase functions deploy send-checkout-reminder --no-verify-jwt
//   (sama seperti send-attendance-reminder - dipicu pg_cron, bukan user
//    login, jadi otorisasinya lewat x-cron-secret, BUKAN Supabase JWT.)
// Secret : pakai CRON_SECRET yang sama dengan send-attendance-reminder
//          (WA_GATEWAY_URL/WA_GATEWAY_SECRET juga sudah ada dari situ)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_GATEWAY_URL = Deno.env.get("WA_GATEWAY_URL")!;
const WA_GATEWAY_SECRET = Deno.env.get("WA_GATEWAY_SECRET")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const DIKECUALIKAN = ["ferza fariz"];

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

  // PENTING: kolom logs.waktu disimpan sebagai teks LOKAL WIB tanpa offset
  // zona waktu - batas filter harus format naive yang sama (tanpa "Z"), lihat
  // catatan lengkap penyebabnya di send-attendance-reminder/index.ts.
  const startUtc = `${tanggal}T00:00:00`;
  const endUtc = `${tanggal}T23:59:59`;

  const { data: logsHariIni, error: errLog } = await supabase
    .from("logs")
    .select("nama, status, waktu")
    .gte("waktu", startUtc)
    .lte("waktu", endUtc)
    .order("waktu", { ascending: true });
  if (errLog) {
    return new Response(JSON.stringify({ error: errLog.message }), { status: 500 });
  }

  // Urutkan log tiap karyawan secara kronologis, lalu telusuri: status
  // "masih di dalam" (belum pulang) jadi true setelah MASUK/DINAS LUAR, dan
  // kembali false setelah PULANG - menangani kasus dinas luar berkali-kali
  // dalam sehari (mis. dinas ke Solo lalu pulang dinas, dinas lagi ke
  // Bandung, dst), bukan cuma sepasang masuk-pulang tunggal.
  const statusPerKaryawan = new Map<string, boolean>();
  for (const l of logsHariIni || []) {
    const s = (l.status || "").toUpperCase();
    if (s.startsWith("MASUK") || s.startsWith("BERANGKAT") || s.startsWith("DINAS LUAR")) {
      statusPerKaryawan.set(l.nama, true);
    } else if (s.startsWith("PULANG")) {
      statusPerKaryawan.set(l.nama, false);
    }
  }

  const belumPulang = (karyawan || []).filter((k) => {
    if (!k.nomor_wa) return false;
    if (DIKECUALIKAN.includes((k.nama || "").trim().toLowerCase())) return false;
    return statusPerKaryawan.get(k.nama) === true;
  });

  const hasil: Array<{ nama: string; status: string; detail?: unknown }> = [];

  for (const k of belumPulang) {
    // Dedup: kalau reminder pulang hari ini sudah pernah tercatat, skip.
    // jenis='pulang' supaya tidak bentrok dengan dedup reminder MASUK.
    const { error: dupErr } = await supabase
      .from("reminder_log")
      .insert({ nama: k.nama, tanggal, jenis: "pulang" });
    if (dupErr) {
      hasil.push({ nama: k.nama, status: "skip-sudah-dikirim" });
      continue;
    }

    const pesan =
      `Yth. Bapak/Ibu *${k.nama}*,\n\n` +
      `Kami informasikan bahwa hingga pukul 23:00 WIB hari ini, sistem mencatat Anda *belum melakukan presensi pulang*.\n\n` +
      `Mohon segera melakukan presensi pulang melalui aplikasi. Perlu kami sampaikan bahwa *perhitungan gaji/jam kerja tidak akan tercatat* apabila presensi pulang tidak dilakukan.\n\n` +
      `Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.\n\n` +
      `Hormat kami,\n_HRIS KOBOI_`;

    try {
      const waRes = await fetch(`${WA_GATEWAY_URL}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gateway-secret": WA_GATEWAY_SECRET,
        },
        body: JSON.stringify({ target: k.nomor_wa, message: pesan }),
      });
      const waJson = await waRes.json();
      hasil.push({ nama: k.nama, status: !waRes.ok || waJson?.error ? "gagal" : "terkirim", detail: waJson });
    } catch (e) {
      hasil.push({ nama: k.nama, status: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(
    JSON.stringify({ tanggal, totalKaryawan: karyawan?.length || 0, totalBelumPulang: belumPulang.length, hasil }),
    { headers: { "Content-Type": "application/json" } }
  );
});
