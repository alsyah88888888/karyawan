// Helper bersama: verifikasi token login admin/super_admin secara MANUAL di
// dalam kode function. Dipakai oleh function yang di-deploy dengan
// --no-verify-jwt (wajib, supaya gateway Supabase tidak menolak token
// custom RS256 kita - gateway cuma paham token native Supabase) - karena
// gateway tidak lagi mengecek apapun, function itu sendiri yang HARUS
// memverifikasi token & role di dalam kodenya, kalau tidak endpoint jadi
// bisa dipanggil siapa saja tanpa otorisasi sama sekali.

import * as jose from "https://esm.sh/jose@5";

const JWT_ISSUER = Deno.env.get("JWT_ISSUER")!;
const JWKS = jose.createRemoteJWKSet(new URL(`${JWT_ISSUER}/.well-known/jwks.json`));

// Verifikasi token APAPUN yang valid (admin, super_admin, atau user/karyawan)
// tanpa mensyaratkan role tertentu - dipakai saat suatu endpoint boleh diakses
// beberapa role sekaligus tapi dengan aturan berbeda per role (function yang
// memanggil ini yang menentukan aturan lanjutannya berdasarkan claims.app_role).
export async function verifyAnyUser(req: Request): Promise<{ ok: true; claims: jose.JWTPayload } | { ok: false; error: string }> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, error: "Token tidak ditemukan" };

  try {
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: "authenticated",
    });
    return { ok: true, claims: payload };
  } catch {
    return { ok: false, error: "Token tidak valid atau kedaluwarsa" };
  }
}

export async function requireAdmin(req: Request): Promise<{ ok: true; claims: jose.JWTPayload } | { ok: false; error: string }> {
  const result = await verifyAnyUser(req);
  if (!result.ok) return result;
  if (result.claims.app_role !== "admin" && result.claims.app_role !== "super_admin") {
    return { ok: false, error: "Hanya admin/super_admin yang boleh mengakses ini" };
  }
  return result;
}
