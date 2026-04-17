/**
 * KOBOI TERMINAL - LOGIC (USER SIDE)
 * Handles cameras, WiFi verification, and attendance processing.
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

const OFFICE_IP = "124.158.189.235";
let KARYAWAN = [];
let allLogs = [];
let bypassWiFi = false;

// --- INITIALIZATION ---
window.onload = async () => {
  await syncDataTerminal();
  initUser();
  
  // LIVE CLOCK
  setInterval(() => {
    const clockEl = document.getElementById("liveClock");
    if (clockEl) clockEl.innerText = new Date().toLocaleTimeString("id-ID");
  }, 1000);
};

async function syncDataTerminal() {
  try {
    const { data: dataKar } = await supabaseClient.from("karyawan").select("*").order("nama", { ascending: true });
    KARYAWAN = dataKar || [];

    const { data: dataLog } = await supabaseClient.from("logs").select("nama, waktu, status").order("id", { ascending: false });
    allLogs = dataLog || [];

    // Populate dropdown
    const sel = document.getElementById("namaSelect");
    if (sel) {
      sel.innerHTML = '<option value="">-- Pilih Nama Anda --</option>';
      KARYAWAN.forEach((k) => sel.innerHTML += `<option value="${k.nama}">${k.nama}</option>`);
    }
  } catch (e) {
    console.error("Sync Error:", e.message);
  }
}

// --- USER INTERFACE LOGIC ---
async function initUser() {
  // CAMERA START
  navigator.mediaDevices
    .getUserMedia({ video: { width: 640, height: 640 } })
    .then((s) => (document.getElementById("video").srcObject = s))
    .catch(() => alert("Kamera diperlukan untuk absensi!"));

  // WIFI VERIFICATION
  updateWiFiStatus();
}

async function updateWiFiStatus() {
  const badge = document.getElementById("wifiStatus");
  if (!badge) return;

  try {
    badge.innerText = "Memverifikasi Jaringan...";
    badge.className = "wifi-badge checking";

    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    const isOffice = (data.ip === OFFICE_IP) || bypassWiFi;

    if (isOffice) {
      badge.innerText = bypassWiFi ? "Bypass Mode Aktif ✅" : "Terhubung WiFi Kantor ✅";
      badge.className = "wifi-badge connected";
      document.getElementById("btnMasuk").disabled = false;
      document.getElementById("btnPulang").disabled = false;
    } else {
      badge.innerText = `Gunakan WiFi Kantor ❌ (${data.ip})`;
      badge.className = "wifi-badge disconnected";
      // Allow bypass on click
      badge.onclick = () => {
        if(confirm("Gunakan Mode Bypass? (Hanya untuk testing/darurat)")) {
          bypassWiFi = true;
          updateWiFiStatus();
        }
      };
    }
  } catch (e) {
    badge.innerText = "Gagal Verifikasi / Offline";
    // Enable for safety if offline check fails
    document.getElementById("btnMasuk").disabled = false;
    document.getElementById("btnPulang").disabled = false;
  }
}

// --- ATTENDANCE PROCESS ---
async function prosesAbsen(tipe) {
  const nama = document.getElementById("namaSelect").value;
  if (!nama) return alert("📢 Harap pilih Nama Anda!");

  const btn = tipe === 'MASUK' ? document.getElementById("btnMasuk") : document.getElementById("btnPulang");
  btn.disabled = true;
  btn.innerText = "PROSES...";

  try {
    const sekarang = new Date();
    const tglHariIni = sekarang.toLocaleDateString("id-ID");

    // 1. Check Double Absen
    const sudahAbsen = allLogs.find(l => 
      l.nama === nama && 
      new Date(l.waktu).toLocaleDateString("id-ID") === tglHariIni && 
      l.status === tipe
    );
    if (sudahAbsen) throw new Error(`Anda SUDAH absen ${tipe} hari ini!`);

    // 2. Capture Photo
    const v = document.getElementById("video");
    const c = document.getElementById("canvas");
    if (v.videoWidth === 0) throw new Error("Kamera belum siap. Tunggu sebentar.");
    
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const fotoData = c.toDataURL("image/webp", 0.4);

    // 3. Calculation Late
    let telat = false;
    if (tipe === "MASUK") {
      const jam = sekarang.getHours();
      const menit = sekarang.getMinutes();
      // Toleransi sampai 09:15 (09:16 baru telat)
      if (jam > 9 || (jam === 9 && menit > 15)) telat = true;
    }

    // 4. Data Info
    const info = KARYAWAN.find((k) => k.nama === nama);
    if (!info) throw new Error("Data karyawan tidak ditemukan!");

    const newLog = {
      nama: info.nama,
      dept: info.dept,
      waktu: sekarang.toISOString(),
      status: tipe,
      foto: fotoData,
      isLate: telat,
    };

    // 5. Send to Cloud
    const { error } = await supabaseClient.from("logs").insert([newLog]);
    if (error) throw error;

    alert(telat ? "✅ BERHASIL! (Anda Terlambat)" : "✅ BERHASIL! Selamat Bekerja.");
    await syncDataTerminal();

  } catch (err) {
    alert("❌ ERROR: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = tipe;
  }
}

// Admin Entry
let loginClicks = 0;
let lastClickTime = 0;

function hiddenLogin() {
  const currentTime = Date.now();
  
  // Jika klik dilakukan dalam jeda < 500ms dari klik sebelumnya
  if (currentTime - lastClickTime < 500) {
    loginClicks++;
  } else {
    loginClicks = 1; // Reset jika terlalu lambat
  }
  
  lastClickTime = currentTime;

  if (loginClicks >= 5) {
    loginClicks = 0; // Reset counter
    loginAdmin();
  }
}

function loginAdmin() {
  const p = prompt("Password Admin:");
  if (p === "mautaubanget") window.location.href = "admin.html";
}
