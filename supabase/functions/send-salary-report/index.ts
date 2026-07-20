// Edge Function: send-salary-report
// Dipanggil dari admin.js (kirimSlipOtomatis) setelah gambar slip diupload ke
// storage bucket "slip-gaji". Function ini yang punya akses ke kredensial WA
// gateway (rahasia), supaya tidak pernah dikirim ke browser admin.
//
// Mengirim lewat wa-gateway self-hosted (Baileys, lihat folder wa-gateway/)
// yang jalan di VPS sendiri - gratis selamanya, mendukung kirim gambar penuh
// tanpa batasan paket/watermark seperti gateway pihak ketiga.
//
// Deploy: supabase functions deploy send-salary-report
// Secret : supabase secrets set WA_GATEWAY_URL=https://wa.domainanda.com
//          supabase secrets set WA_GATEWAY_SECRET=xxxxxxxxxxxx

const WA_GATEWAY_URL = Deno.env.get("WA_GATEWAY_URL")!;
const WA_GATEWAY_SECRET = Deno.env.get("WA_GATEWAY_SECRET")!;

// Dipanggil langsung dari browser (admin.html di-hosting di domain lain, mis.
// Vercel), jadi wajib kirim header CORS - tanpa ini browser menolak membaca
// respons dan supabase-js melempar "Failed to send a request to the Edge Function".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { nama, nomor_wa, imageUrl, periode, totalThp } = await req.json();

    if (!nomor_wa || !imageUrl) {
      return new Response(
        JSON.stringify({ error: "nomor_wa dan imageUrl wajib diisi" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pesan =
      `Halo *${nama}*,\n\n` +
      `Berikut *Slip Gaji Digital* Anda untuk periode *${periode}*.\n` +
      `Total Gaji Bersih (THP): *Rp ${Number(totalThp || 0).toLocaleString("id-ID")}*\n\n` +
      `Slip ini bersifat rahasia, mohon tidak disebarluaskan.\n` +
      `_Pesan otomatis - HRIS KOBOI_`;

    const waRes = await fetch(`${WA_GATEWAY_URL}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gateway-secret": WA_GATEWAY_SECRET,
      },
      body: JSON.stringify({ target: nomor_wa, message: pesan, imageUrl }),
    });
    const waJson = await waRes.json();

    if (!waRes.ok || waJson?.error) {
      return new Response(
        JSON.stringify({ error: waJson.error || "Gagal mengirim via wa-gateway", detail: waJson }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true, detail: waJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
