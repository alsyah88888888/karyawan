// Edge Function: send-leave-notification
// Kirim WA otomatis di dua momen alur pengajuan cuti:
//   - event "new_request": karyawan baru saja mengajukan cuti -> WA ke admin
//   - event "approved"/"rejected": admin baru saja memutuskan -> WA ke karyawan
// Data (nama, nomor WA, tanggal, dst) selalu diambil ulang dari database
// pakai service_role, TIDAK dipercaya dari payload client - supaya tidak bisa
// dipakai mengirim pesan palsu ke nomor sembarangan.
//
// Deploy: supabase functions deploy send-leave-notification --no-verify-jwt
// Secret : supabase secrets set ADMIN_NOTIFY_PHONE=628xxxxxxxxxx
//          (WA_GATEWAY_URL, WA_GATEWAY_SECRET, JWT_ISSUER sudah ada dari fitur lain)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAnyUser } from "../_shared/verifyAdmin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_GATEWAY_URL = Deno.env.get("WA_GATEWAY_URL")!;
const WA_GATEWAY_SECRET = Deno.env.get("WA_GATEWAY_SECRET")!;
const ADMIN_NOTIFY_PHONE = Deno.env.get("ADMIN_NOTIFY_PHONE")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function kirimWA(target: string, message: string) {
  const res = await fetch(`${WA_GATEWAY_URL}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-gateway-secret": WA_GATEWAY_SECRET },
    body: JSON.stringify({ target, message }),
  });
  const j = await res.json();
  if (!res.ok || j?.error) throw new Error(j?.error || "Gagal mengirim WA");
}

function fmtTgl(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await verifyAnyUser(req);
  if (!auth.ok) return json({ error: auth.error }, 401);

  try {
    const { leaveRequestId, event } = await req.json();
    if (!leaveRequestId || !["new_request", "approved", "rejected"].includes(event)) {
      return json({ error: "leaveRequestId dan event (new_request/approved/rejected) wajib diisi" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: lv, error: lvErr } = await supabase
      .from("leave_requests")
      .select("id, employee_id, type, start_date, end_date, reason, rejection_reason, karyawan(nama, nomor_wa, sisa_cuti)")
      .eq("id", leaveRequestId)
      .single();

    if (lvErr || !lv) return json({ error: "Pengajuan cuti tidak ditemukan" }, 404);
    const karyawan = Array.isArray(lv.karyawan) ? lv.karyawan[0] : lv.karyawan;

    const isAdmin = auth.claims.app_role === "admin" || auth.claims.app_role === "super_admin";
    const isOwner = auth.claims.app_role === "user" && Number(auth.claims.karyawan_id) === lv.employee_id;

    if (event === "new_request") {
      // Yang boleh memicu notifikasi "pengajuan baru": karyawan pemilik pengajuan itu sendiri, atau admin.
      if (!isAdmin && !isOwner) return json({ error: "Tidak diizinkan" }, 403);
      if (!ADMIN_NOTIFY_PHONE) return json({ error: "ADMIN_NOTIFY_PHONE belum di-set" }, 500);

      const pesan =
        `📋 *Pengajuan Cuti Baru*\n\n` +
        `${karyawan?.nama} mengajukan *${lv.type}*\n` +
        `${fmtTgl(lv.start_date)} s/d ${fmtTgl(lv.end_date)}\n` +
        `Alasan: ${lv.reason}\n\n` +
        `Buka admin panel untuk memproses.\n` +
        `_Pesan otomatis - HRIS KOBOI_`;
      await kirimWA(ADMIN_NOTIFY_PHONE, pesan);
    } else {
      // Notifikasi hasil keputusan (approved/rejected): hanya admin/super_admin yang boleh memicu.
      if (!isAdmin) return json({ error: "Hanya admin yang boleh mengirim notifikasi keputusan" }, 403);
      if (!karyawan?.nomor_wa) return json({ error: "Karyawan tidak punya nomor WA" }, 400);

      const pesan =
        event === "approved"
          ? `✅ Pengajuan *${lv.type}* Anda (${fmtTgl(lv.start_date)} s/d ${fmtTgl(lv.end_date)}) telah *DISETUJUI*.\nSisa cuti Anda sekarang: *${karyawan.sisa_cuti ?? 0} hari*.\n\n_Pesan otomatis - HRIS KOBOI_`
          : `❌ Pengajuan *${lv.type}* Anda (${fmtTgl(lv.start_date)} s/d ${fmtTgl(lv.end_date)}) *DITOLAK*.${lv.rejection_reason ? `\nAlasan: ${lv.rejection_reason}` : ""}\nSilakan hubungi atasan untuk info lebih lanjut.\n\n_Pesan otomatis - HRIS KOBOI_`;
      await kirimWA(karyawan.nomor_wa, pesan);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
