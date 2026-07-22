// Edge Function: login-admin
// Verifikasi username + password admin/super_admin, terbitkan token JWT
// (RS256, kunci privat sendiri) yang dipakai admin.js untuk mengakses
// Supabase secara aman sesuai role - RLS di database membaca klaim ini.
//
// Menggantikan pengecekan password bersama "mautaubanget" yang lama di
// script.js - sekarang tiap admin punya akun sendiri di tabel admin_accounts.
//
// Deploy: supabase functions deploy login-admin --no-verify-jwt
// Secret : sama dengan login-employee (JWT_PRIVATE_JWK, JWT_KID, JWT_ISSUER)

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
    const { username, password } = await req.json();
    if (!username || !password) return json({ error: "Username dan password wajib diisi" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const sejak = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("identifier", username)
      .eq("attempt_type", "admin")
      .eq("succeeded", false)
      .gte("attempted_at", sejak);

    if ((count || 0) >= MAX_ATTEMPTS) {
      return json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${WINDOW_MINUTES} menit.` }, 429);
    }

    const { data: acc } = await supabase
      .from("admin_accounts")
      .select("id, username, nama, role, is_active, password_hash")
      .eq("username", username)
      .maybeSingle();

    const valid = acc?.is_active && acc?.password_hash ? bcrypt.compareSync(String(password), acc.password_hash) : false;

    await supabase.from("login_attempts").insert({ identifier: username, attempt_type: "admin", succeeded: valid });

    if (!valid || !acc) {
      return json({ error: "Username atau password salah" }, 401);
    }

    await supabase.from("admin_accounts").update({ last_login_at: new Date().toISOString() }).eq("id", acc.id);

    // Catatan penting: klaim bernama "role" DIRESERVE oleh PostgREST sebagai
    // nama Postgres role untuk di-SET ROLE - bukan tempat untuk data role
    // aplikasi kita ("admin"/"super_admin" bukan Postgres role sungguhan,
    // makanya dipakai nama klaim "app_role" yang bebas kita definisikan
    // sendiri dan dibaca RLS via auth.jwt()->>'app_role'.
    const privateKey = await jose.importJWK(JWT_PRIVATE_JWK, "RS256");
    const token = await new jose.SignJWT({
      app_role: acc.role, // 'admin' | 'super_admin'
      admin_id: acc.id,
      nama: acc.nama,
    })
      .setProtectedHeader({ alg: "RS256", kid: JWT_KID })
      .setIssuedAt()
      .setIssuer(JWT_ISSUER)
      .setAudience("authenticated")
      .setSubject(`admin:${acc.id}`)
      .setExpirationTime("8h")
      .sign(privateKey);

    return json({ token, user: { id: acc.id, nama: acc.nama, role: acc.role } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
