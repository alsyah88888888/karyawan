// Edge Function: login-employee
// Verifikasi NIK + PIN karyawan, terbitkan token JWT (ditandatangani dengan
// kunci privat kita sendiri, RS256) yang dipakai browser untuk mengakses
// Supabase secara aman - RLS di database membaca klaim di token ini.
//
// UX di employee.js TIDAK berubah (tetap isi NIK+PIN) - yang berubah cuma
// verifikasinya sekarang beneran server-side + hash, bukan cek plaintext
// langsung dari browser.
//
// Deploy: supabase functions deploy login-employee --no-verify-jwt
// Secret : supabase secrets set JWT_PRIVATE_JWK=... JWT_KID=... JWT_ISSUER=...
//          (SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY otomatis tersedia)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://esm.sh/jose@5";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWT_PRIVATE_JWK = JSON.parse(Deno.env.get("JWT_PRIVATE_JWK")!);
const JWT_KID = Deno.env.get("JWT_KID")!;
const JWT_ISSUER = Deno.env.get("JWT_ISSUER")!;

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { nik, pin } = await req.json();
    if (!nik || !pin) return json({ error: "NIK dan PIN wajib diisi" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Cek throttle percobaan login gagal
    const sejak = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("identifier", nik)
      .eq("attempt_type", "employee")
      .eq("succeeded", false)
      .gte("attempted_at", sejak);

    if ((count || 0) >= MAX_ATTEMPTS) {
      return json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${WINDOW_MINUTES} menit.` }, 429);
    }

    // 2. Ambil data karyawan & verifikasi PIN
    const { data: k } = await supabase
      .from("karyawan")
      .select("id, nama, nik, dept, jabatan, sisa_cuti, foto_url, pin_hash")
      .eq("nik", nik)
      .maybeSingle();

    const valid = k?.pin_hash ? bcrypt.compareSync(String(pin), k.pin_hash) : false;

    await supabase.from("login_attempts").insert({ identifier: nik, attempt_type: "employee", succeeded: valid });

    if (!valid || !k) {
      return json({ error: "NIK atau PIN salah" }, 401);
    }

    // 3. Terbitkan token
    // Catatan penting: klaim "role" DIRESERVE oleh PostgREST sebagai nama
    // Postgres role untuk SET ROLE - data role aplikasi kita dipakai nama
    // klaim terpisah "app_role", dibaca RLS via auth.jwt()->>'app_role'.
    const privateKey = await jose.importJWK(JWT_PRIVATE_JWK, "RS256");
    const token = await new jose.SignJWT({
      app_role: "user",
      karyawan_id: k.id,
      nik: k.nik,
      nama: k.nama,
      dept: k.dept,
      jabatan: k.jabatan,
    })
      .setProtectedHeader({ alg: "RS256", kid: JWT_KID })
      .setIssuedAt()
      .setIssuer(JWT_ISSUER)
      .setAudience("authenticated")
      .setSubject(`karyawan:${k.id}`)
      .setExpirationTime("12h")
      .sign(privateKey);

    return json({
      token,
      user: { id: k.id, nama: k.nama, nik: k.nik, dept: k.dept, jabatan: k.jabatan, sisa_cuti: k.sisa_cuti, foto_url: k.foto_url },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
