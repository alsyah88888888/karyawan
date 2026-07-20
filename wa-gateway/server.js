// Gateway WhatsApp self-hosted (Baileys) untuk HRIS KOBOI.
// Menggantikan Fonnte: gratis selamanya, tanpa batasan attachment/watermark,
// karena login pakai akun WhatsApp sendiri via QR code (bukan API pihak ketiga).
//
// Cara pakai singkat (detail lengkap ada di panduan deploy):
//   1. npm install
//   2. cp .env.example .env, lalu isi GATEWAY_SECRET dengan string acak sendiri
//   3. npm start -> scan QR yang muncul di terminal pakai WhatsApp di HP
//   4. Endpoint POST /send siap dipanggil dari Edge Function Supabase

require("dotenv").config();

const express = require("express");
const pino = require("pino");
const qrcodeTerminal = require("qrcode-terminal");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const PORT = process.env.PORT || 5501;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;

if (!GATEWAY_SECRET) {
  console.error("GATEWAY_SECRET belum diisi di .env. Isi dengan string acak (mis. hasil `openssl rand -hex 24`).");
  process.exit(1);
}

const logger = pino({ level: "warn" });

let sock = null;
let isReady = false;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_session");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false, // kita cetak sendiri di bawah supaya lebih jelas
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=== SCAN QR INI DENGAN WHATSAPP DI HP (Linked Devices) ===\n");
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      isReady = true;
      console.log("[wa-gateway] Terhubung ke WhatsApp. Siap menerima request /send.");
    }

    if (connection === "close") {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.warn("[wa-gateway] Koneksi terputus.", { statusCode, shouldReconnect });

      if (shouldReconnect) {
        setTimeout(startSock, 3000);
      } else {
        console.error("[wa-gateway] Logged out. Hapus folder auth_session/ lalu restart & scan QR ulang.");
      }
    }
  });
}

startSock().catch((err) => {
  console.error("[wa-gateway] Gagal start koneksi WhatsApp:", err);
  process.exit(1);
});

// --- HTTP API ---

const app = express();
app.use(express.json({ limit: "2mb" }));

function checkAuth(req, res, next) {
  if (req.header("x-gateway-secret") !== GATEWAY_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({ ready: isReady });
});

// Body: { target: "6281234567890", message: "teks", imageUrl?: "https://..." }
app.post("/send", checkAuth, async (req, res) => {
  if (!isReady || !sock) {
    return res.status(503).json({ error: "WhatsApp belum terhubung, coba lagi sebentar." });
  }

  const { target, message, imageUrl } = req.body || {};
  if (!target || !message) {
    return res.status(400).json({ error: "target dan message wajib diisi" });
  }

  const digits = String(target).replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("62") ? digits : "62" + digits;
  const jid = `${normalized}@s.whatsapp.net`;

  try {
    if (imageUrl) {
      await sock.sendMessage(jid, { image: { url: imageUrl }, caption: message });
    } else {
      await sock.sendMessage(jid, { text: message });
    }
    res.json({ ok: true, target: normalized });
  } catch (err) {
    console.error("[wa-gateway] Gagal kirim:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[wa-gateway] HTTP server jalan di port ${PORT}`);
});
