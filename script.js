/**
 * KOBOI TERMINAL - PREMIUM LOGIC (USER SIDE)
 * Handles cameras, WiFi verification, and attendance processing with Modern UI.
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

const OFFICE_IP = "124.158.189.235";
let KARYAWAN = [];
let allLogs = [];
let bypassWiFi = false;
let isNetworkValid = false;

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
      KARYAWAN.forEach((k) => {
        const option = document.createElement("option");
        option.value = k.nama;
        option.textContent = k.nama;
        sel.appendChild(option);
      });
    }
  } catch (e) {
    console.error("Sync Error:", e.message);
  }
}

// --- USER INTERFACE LOGIC ---
async function initUser() {
  // CAMERA START
  const video = document.getElementById("video");
  if (video) {
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 640 } })
      .then((s) => (video.srcObject = s))
      .catch(() => showModernAlert("Kamera diperlukan untuk absensi!", "error"));
  }

  // WIFI VERIFICATION
  updateWiFiStatus();
}

async function updateWiFiStatus() {
  const badge = document.getElementById("wifiStatus");
  if (!badge) return;

  try {
    badge.innerText = "MEMVERIFIKASI JARINGAN...";
    badge.className = "wifi-badge checking";

    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    const isOffice = (data.ip === OFFICE_IP) || bypassWiFi;

    if (isOffice) {
      badge.innerText = bypassWiFi ? "BYPASS MODE AKTIF ✅" : "WIFI KANTOR TERHUBUNG ✅";
      badge.className = "wifi-badge connected";
      isNetworkValid = true;
    } else {
      badge.innerText = `Gunakan WiFi Kantor ❌ (${data.ip})`;
      badge.className = "wifi-badge disconnected";
      
      badge.onclick = async () => {
        const pass = await showModernPrompt("Admin Security", "Masukkan Password Admin untuk akses Bypass:", "password");
        if (pass === "mautaubanget") {
          bypassWiFi = true;
          updateWiFiStatus();
        } else if (pass !== null) {
          showModernAlert("Akses Ditolak! Password salah.", "error");
        }
      };
    }
  } catch (e) {
    badge.innerText = "GAGAL VERIFIKASI / OFFLINE ❌";
    badge.className = "wifi-badge disconnected";
    isNetworkValid = false;
  }
}

// --- ATTENDANCE PROCESS ---
async function prosesAbsen(tipe) {
  const isDinas = (tipe === 'DINAS LUAR' || tipe === 'PULANG DINAS');

  if (!isNetworkValid && !isDinas) {
    return showModernAlert("SECURITY WARNING: Jaringan Anda belum terverifikasi! Gunakan WiFi Kantor.", "error");
  }

  const nama = document.getElementById("namaSelect").value;
  if (!nama) return showModernAlert("Harap pilih Nama Anda terlebih dahulu!", "info");

  let finalTipe = tipe;
  if (isDinas) {
    const lokasi = await showModernPrompt("Dinas Luar", `Masukkan lokasi/tujuan ${tipe} Anda:`, "text");
    if (!lokasi || lokasi.trim() === "") return; // Cancelled
    finalTipe = `${tipe} - ${lokasi.trim().toUpperCase()}`;
  }

  let btn;
  if (tipe === 'MASUK') btn = document.getElementById("btnMasuk");
  else if (tipe === 'PULANG') btn = document.getElementById("btnPulang");
  else if (tipe === 'DINAS LUAR') btn = document.getElementById("btnDinasMasuk");
  else if (tipe === 'PULANG DINAS') btn = document.getElementById("btnDinasPulang");

  const originalText = btn ? btn.innerText : "";
  if (btn) {
    btn.disabled = true;
    btn.innerText = "PROSES...";
  }

  try {
    const sekarang = new Date();
    const getShiftDateStr = (dateObj) => new Date(dateObj.getTime() - 5 * 60 * 60 * 1000).toLocaleDateString("id-ID");
    const tglHariIni = getShiftDateStr(sekarang);

    const sudahAbsen = allLogs.find(l => 
      l.nama === nama && 
      getShiftDateStr(new Date(l.waktu)) === tglHariIni && 
      l.status.startsWith(tipe)
    );
    if (sudahAbsen) throw new Error(`Anda SUDAH absen ${tipe} hari ini!`);

    const v = document.getElementById("video");
    const c = document.getElementById("canvas");
    if (!v || v.videoWidth === 0) throw new Error("Kamera belum siap. Tunggu sebentar.");
    
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const fotoData = c.toDataURL("image/webp", 0.4);

    let telat = false;
    if (tipe === "MASUK" || tipe === "DINAS LUAR") {
      const jam = sekarang.getHours();
      const menit = sekarang.getMinutes();
      if (jam > 9 || (jam === 9 && menit > 15)) telat = true;
    }

    const info = KARYAWAN.find((k) => k.nama === nama);
    if (!info) throw new Error("Data karyawan tidak ditemukan!");

    const newLog = {
      nama: info.nama,
      dept: info.dept,
      waktu: sekarang.toISOString(),
      status: finalTipe,
      foto: fotoData,
      isLate: telat,
    };

    const { error } = await supabaseClient.from("logs").insert([newLog]);
    if (error) throw error;

    showModernAlert(telat ? "BERHASIL! (Anda Terlambat)" : "BERHASIL! Selamat Bekerja.", telat ? "warning" : "success");
    await syncDataTerminal();

  } catch (err) {
    showModernAlert("GAGAL: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = originalText;
    }
  }
}

// --- MODERN MODAL SYSTEM ---
let modalResolve = null;

function showModernAlert(msg, type = "info") {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modalOverlay");
    const title = document.getElementById("modalTitle");
    const message = document.getElementById("modalMessage");
    const inputCont = document.getElementById("modalInputContainer");
    const cancelBtn = document.getElementById("modalCancelBtn");
    const confirmBtn = document.getElementById("modalConfirmBtn");
    const icon = document.getElementById("modalIcon");

    title.innerText = type.toUpperCase();
    message.innerText = msg;
    inputCont.style.display = "none";
    cancelBtn.style.display = "none";
    
    // Icon & Color
    icon.style.background = type === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(79, 70, 229, 0.1)";
    icon.style.color = type === "error" ? "#ef4444" : "#4f46e5";
    icon.innerText = type === "success" ? "✓" : "!";

    confirmBtn.onclick = () => {
      overlay.style.display = "none";
      resolve();
    };

    overlay.style.display = "flex";
  });
}

function showModernPrompt(ttl, msg, inputType = "text") {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modalOverlay");
    const title = document.getElementById("modalTitle");
    const message = document.getElementById("modalMessage");
    const inputCont = document.getElementById("modalInputContainer");
    const input = document.getElementById("modalInput");
    const cancelBtn = document.getElementById("modalCancelBtn");
    const confirmBtn = document.getElementById("modalConfirmBtn");

    title.innerText = ttl;
    message.innerText = msg;
    inputCont.style.display = "block";
    input.type = inputType;
    input.value = "";
    cancelBtn.style.display = "block";

    confirmBtn.onclick = () => {
      overlay.style.display = "none";
      resolve(input.value);
    };

    modalResolve = resolve;
    overlay.style.display = "flex";
    setTimeout(() => input.focus(), 100);
  });
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  if (modalResolve) modalResolve(null);
}

// Admin Entry (Hidden)
let loginClicks = 0;
let lastClickTime = 0;

function hiddenLogin() {
  const currentTime = Date.now();
  if (currentTime - lastClickTime < 500) {
    loginClicks++;
  } else {
    loginClicks = 1;
  }
  lastClickTime = currentTime;

  if (loginClicks >= 5) {
    loginClicks = 0;
    loginAdmin();
  }
}

async function loginAdmin() {
  const p = await showModernPrompt("Security Entry", "Masukkan Password Admin:", "password");
  if (p === "mautaubanget") window.location.href = "admin.html";
  else if (p !== null) showModernAlert("Password Salah!", "error");
}
