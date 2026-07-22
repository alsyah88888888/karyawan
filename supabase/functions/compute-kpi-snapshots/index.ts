// Edge Function: compute-kpi-snapshots
// Dipanggil pg_cron 3x (harian/mingguan/bulanan, lihat migration
// 0005_kpi_cron.sql) - menghitung skor KPI otomatis tiap karyawan untuk
// periode yang baru saja selesai, disimpan ke tabel kpi_snapshots supaya
// dashboard tidak perlu hitung ulang dari tabel logs tiap kali dibuka.
//
// Catatan penting: logika hadir/telat di sini adalah PORTING dari
// hitungDetailGaji() di admin.js (~admin.js:679-726) - hanya bagian
// murni hadir/telat/hari-kerja-nya saja (bukan lembur/gaji), karena
// hitungDetailGaji aslinya bergantung pada DOM/variabel global browser
// dan tidak bisa dipanggil langsung dari sini (Deno, server-side).
// KALAU formula hadir/telat di admin.js berubah, mirror perubahannya
// ke sini juga supaya skor KPI tidak melenceng dari angka payroll.
//
// Deploy: supabase functions deploy compute-kpi-snapshots --no-verify-jwt
// Secret : supabase secrets set KPI_CRON_SECRET=xxxxxxxxxxxx

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KPI_CRON_SECRET = Deno.env.get("KPI_CRON_SECRET")!;

type PeriodType = "daily" | "weekly" | "monthly";

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Tanggal "hari ini" versi WIB (UTC+7), dipakai sebagai titik acuan semua
// perhitungan periode di bawah - konsisten dengan getISODate() di script.js.
function todayWIB(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function getPeriodRange(periodType: PeriodType): { start: string; end: string } {
  const now = todayWIB();

  if (periodType === "daily") {
    const d = toISODate(now);
    return { start: d, end: d };
  }

  if (periodType === "weekly") {
    // Dipanggil Senin dini hari untuk minggu yang BARU SAJA selesai (Senin-Minggu lalu)
    const hari = now.getUTCDay(); // 0=Minggu..6=Sabtu (now sudah digeser ke WIB)
    const selisihKeSeninIni = hari === 0 ? 6 : hari - 1;
    const seninIni = new Date(now);
    seninIni.setUTCDate(now.getUTCDate() - selisihKeSeninIni);
    const seninLalu = new Date(seninIni);
    seninLalu.setUTCDate(seninIni.getUTCDate() - 7);
    const mingguLalu = new Date(seninLalu);
    mingguLalu.setUTCDate(seninLalu.getUTCDate() + 6);
    return { start: toISODate(seninLalu), end: toISODate(mingguLalu) };
  }

  // monthly: dipanggil tanggal 1 untuk bulan yang baru saja selesai
  const bulanIni = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const bulanLaluAkhir = new Date(bulanIni);
  bulanLaluAkhir.setUTCDate(bulanLaluAkhir.getUTCDate() - 1);
  const bulanLaluAwal = new Date(Date.UTC(bulanLaluAkhir.getUTCFullYear(), bulanLaluAkhir.getUTCMonth(), 1));
  return { start: toISODate(bulanLaluAwal), end: toISODate(bulanLaluAkhir) };
}

// Jumlah hari kerja efektif (semua hari kecuali Minggu) - porting dari
// hitungHariKerjaEfektif() di admin.js:666-677.
function hitungHariKerjaEfektif(startStr: string, endStr: string): number {
  const start = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T23:59:59Z");
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getUTCDay() !== 0) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== KPI_CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let periodType: PeriodType = "daily";
  try {
    const body = await req.json();
    if (body?.periodType) periodType = body.periodType;
  } catch {
    // body kosong -> default 'daily'
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { start, end } = getPeriodRange(periodType);
  const totalHariKerja = hitungHariKerjaEfektif(start, end);

  const { data: karyawan, error: errKar } = await supabase
    .from("karyawan")
    .select("id, nama, dept, jabatan");
  if (errKar) return new Response(JSON.stringify({ error: errKar.message }), { status: 500 });

  const startUtc = new Date(`${start}T00:00:00+07:00`).toISOString();
  const endUtc = new Date(`${end}T23:59:59+07:00`).toISOString();

  const { data: logsPeriode, error: errLog } = await supabase
    .from("logs")
    .select("karyawan_id, nama, status, waktu, isLate")
    .gte("waktu", startUtc)
    .lte("waktu", endUtc);
  if (errLog) return new Response(JSON.stringify({ error: errLog.message }), { status: 500 });

  const results: Array<{ employee_id: number; status: string }> = [];

  for (const k of karyawan || []) {
    const logsKaryawan = (logsPeriode || []).filter(
      (l) => l.karyawan_id === k.id || l.nama?.trim().toLowerCase() === k.nama?.trim().toLowerCase()
    );

    // hadir: hari unik (buffer shift malam 4 jam) dengan status MASUK/BERANGKAT/DINAS LUAR
    const hariHadirSet = new Set<string>();
    for (const l of logsKaryawan) {
      const s = (l.status || "").toUpperCase();
      if (s.startsWith("MASUK") || s.startsWith("BERANGKAT") || s.startsWith("DINAS LUAR")) {
        const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
        if (d.getUTCDay() !== 0) hariHadirSet.add(toISODate(d));
      }
    }
    const hadir = hariHadirSet.size;

    const telat = logsKaryawan.filter((l) => {
      const s = (l.status || "").toUpperCase();
      return (s.startsWith("MASUK") || s.startsWith("DINAS LUAR")) && l.isLate;
    }).length;

    const attendanceScore = totalHariKerja > 0 ? Math.min(100, (hadir / totalHariKerja) * 100) : 0;
    // Diklem 0-100: kalau ada beberapa log MASUK/DINAS LUAR telat di hari yang
    // sama (mis. absen dibetulkan admin), telat (dihitung per baris log) bisa
    // lebih besar dari hadir (dihitung per hari unik) - jangan sampai skor jadi negatif.
    const punctualityScore = hadir > 0 ? Math.max(0, Math.min(100, ((hadir - telat) / hadir) * 100)) : 0;

    // Skor manual terakhir (kalau ada) dari performance_reviews dalam periode ini
    const { data: review } = await supabase
      .from("performance_reviews")
      .select("kpi_score")
      .eq("employee_id", k.id)
      .gte("period", start)
      .lte("period", end)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    const manualScore = review?.kpi_score != null ? Number(review.kpi_score) : null;
    const finalScore =
      manualScore != null
        ? attendanceScore * 0.35 + punctualityScore * 0.25 + manualScore * 0.4
        : attendanceScore * 0.6 + punctualityScore * 0.4;

    const finalGrade = finalScore >= 85 ? "A" : finalScore >= 70 ? "B" : "C";

    const { error: upsertErr } = await supabase.from("kpi_snapshots").upsert(
      {
        employee_id: k.id,
        period_type: periodType,
        period_start: start,
        period_end: end,
        dept: k.dept,
        jabatan: k.jabatan,
        attendance_score: Math.round(attendanceScore * 100) / 100,
        punctuality_score: Math.round(punctualityScore * 100) / 100,
        manual_kpi_score: manualScore,
        final_score: Math.round(finalScore * 100) / 100,
        final_grade: finalGrade,
        hadir,
        telat,
        total_hari_kerja: totalHariKerja,
      },
      { onConflict: "employee_id,period_type,period_start" }
    );

    results.push({ employee_id: k.id, status: upsertErr ? `error: ${upsertErr.message}` : "ok" });
  }

  return new Response(
    JSON.stringify({ periodType, start, end, totalKaryawan: karyawan?.length || 0, results }),
    { headers: { "Content-Type": "application/json" } }
  );
});
