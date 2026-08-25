/**
 * KOBOI TERMINAL - PREMIUM LOGIC (USER SIDE)
 * Handles cameras, WiFi verification, and attendance processing with Modern UI.
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

// Tambahkan IP baru ke dalam daftar (Array) agar lebih fleksibel
const OFFICE_IPS = ["103.108.130.41", "103.108.130.43", "124.158.189.235", "114.124.238.252", "202.51.197.78"];
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
    const now = new Date();
    const clockEl = document.getElementById("liveClock");
    const dateEl = document.getElementById("liveDate");

    if (clockEl) clockEl.innerText = now.toLocaleTimeString("id-ID");
    if (dateEl) {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      dateEl.innerText = now.toLocaleDateString("id-ID", options);
    }
  }, 1000);

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Network offline/online listeners
  window.addEventListener('online', () => {
    updateWiFiStatus();
    syncOfflineData();
  });
  window.addEventListener('offline', updateWiFiStatus);

  // Sync offline data on startup
  await syncOfflineData();
};

async function syncDataTerminal() {
  try {
    // Kiosk anonim (tanpa login) cuma boleh baca daftar nama/dept lewat view
    // publik ini - data sensitif (gaji, PIN, rekening, dst) tidak ikut terbawa.
    const { data: dataKar } = await supabaseClient.from("karyawan_public").select("*").order("nama", { ascending: true });
    KARYAWAN = dataKar || [];
    if (KARYAWAN.length > 0) {
      localStorage.setItem("koboi_karyawan", JSON.stringify(KARYAWAN));
    }

    const { data: dataLog } = await supabaseClient.from("logs").select("nama, waktu, status").order("id", { ascending: false });
    allLogs = dataLog || [];
  } catch (e) {
    console.error("Sync Error:", e.message);
    const cachedKar = localStorage.getItem("koboi_karyawan");
    if (cachedKar) {
      KARYAWAN = JSON.parse(cachedKar);
    }
  }

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

  if (!navigator.onLine) {
    badge.innerText = "OFFLINE MODE AKTIF ⚠️";
    badge.className = "wifi-badge disconnected";
    isNetworkValid = true; // Izinkan absen saat offline (disimpan lokal)
    return;
  }

  try {
    badge.innerText = "MEMVERIFIKASI JARINGAN...";
    badge.className = "wifi-badge checking";

    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    const currentIp = data.ip ? data.ip.trim() : "";
    const isOffice = OFFICE_IPS.map(ip => ip.trim()).includes(currentIp) || bypassWiFi;

    if (isOffice) {
      badge.innerText = bypassWiFi ? "BYPASS MODE AKTIF ✅" : "WIFI KANTOR TERHUBUNG ✅";
      badge.className = "wifi-badge connected";
      isNetworkValid = true;
    } else {
      badge.innerText = `Gunakan WiFi Kantor ❌ (${data.ip})`;
      badge.className = "wifi-badge disconnected";
      isNetworkValid = false; // Reset ke false jika IP tidak cocok

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
    badge.innerText = "OFFLINE MODE (JARINGAN ERROR) ⚠️";
    badge.className = "wifi-badge disconnected";
    isNetworkValid = true; // Izinkan absen jika koneksi ke ipify gagal/koneksi putus
  }
}

function toLocalISO(date) {
  const pad = num => (num < 10 ? '0' : '') + num;
  // Simpan dalam format YYYY-MM-DDTHH:mm:ss (tanpa offset agar tidak digeser oleh browser lain)
  return date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes()) +
    ':' + pad(date.getSeconds());
}

function getISODate(dateObj) {
  // Geser 5 jam ke belakang untuk menentukan "Hari Kerja" (Mendukung Shift Malam)
  const d = new Date(dateObj.getTime() - 5 * 60 * 60 * 1000);
  const pad = num => (num < 10 ? '0' : '') + num;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// Tanggal Senin (00:00) dari minggu berjalan, dipakai untuk hitung berapa kali
// telat dalam seminggu. Pakai basis "Hari Kerja" yang sama dengan getISODate.
function getMondayISO(dateObj) {
  const d = new Date(dateObj.getTime() - 5 * 60 * 60 * 1000);
  const hari = d.getDay(); // 0=Minggu, 1=Senin, ... 6=Sabtu
  const selisihKeSenin = hari === 0 ? 6 : hari - 1;
  d.setDate(d.getDate() - selisihKeSenin);
  const pad = num => (num < 10 ? '0' : '') + num;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function getSapaanWaktu(jam) {
  if (jam < 10) return "Selamat Pagi";
  if (jam < 15) return "Selamat Siang";
  if (jam < 18) return "Selamat Sore";
  return "Selamat Malam";
}

function capturePhoto() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("canvas");
  if (!video || video.videoWidth === 0) return null;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.4);
}

// --- OFFLINE STORAGE & SYNC HELPERS ---
function getOfflineLogs() {
  const logs = localStorage.getItem("koboi_offline_logs");
  return logs ? JSON.parse(logs) : [];
}

function saveOfflineLog(log) {
  const logs = getOfflineLogs();
  logs.push(log);
  localStorage.setItem("koboi_offline_logs", JSON.stringify(logs));
}

let isSyncing = false;
async function syncOfflineData() {
  if (isSyncing) return;
  if (!navigator.onLine) return;

  const logs = getOfflineLogs();
  if (logs.length === 0) return;

  isSyncing = true;
  const badge = document.getElementById("wifiStatus");
  if (badge) {
    badge.innerText = `MENYINKRONKAN DATA OFFLINE (${logs.length})...`;
    badge.className = "wifi-badge checking";
  }

  const failedLogs = [];
  for (const log of logs) {
    try {
      const { error } = await supabaseClient.from("logs").insert([log]);
      if (error) throw error;
    } catch (e) {
      console.error("Gagal sinkronisasi data offline:", e);
      failedLogs.push(log);
    }
  }

  localStorage.setItem("koboi_offline_logs", JSON.stringify(failedLogs));
  isSyncing = false;

  if (failedLogs.length === 0) {
    showModernAlert("Semua absensi offline berhasil disinkronkan ke server!", "success");
  } else {
    showModernAlert(`Gagal menyinkronkan ${failedLogs.length} data absensi. Akan dicoba kembali nanti.`, "error");
  }

  await syncDataTerminal();
  updateWiFiStatus();
}

// --- ATTENDANCE PROCESS ---
async function prosesAbsen(tipe) {
  const isDinas = (tipe === 'DINAS LUAR' || tipe === 'PULANG DINAS');

  if (!isNetworkValid && !isDinas) {
    return showModernAlert("SECURITY WARNING: Jaringan Anda belum terverifikasi! Gunakan WiFi Kantor.", "error");
  }

  const nama = document.getElementById("namaSelect").value;
  if (!nama) return showModernAlert("Harap pilih Nama Anda terlebih dahulu!", "info");

  // Tombol di-disable SEBELUM proses async apapun (termasuk dialog GPS/lokasi
  // Dinas Luar di bawah) - sebelumnya baru di-disable setelah dialog itu,
  // jadi klik ganda cepat bisa memicu dua proses absen Dinas Luar bersamaan.
  let btn;
  if (tipe === 'MASUK') btn = document.getElementById("btnMasuk");
  else if (tipe === 'PULANG') btn = document.getElementById("btnPulang");
  else if (tipe === 'DINAS LUAR') btn = document.getElementById("btnDinasMasuk");
  else if (tipe === 'PULANG DINAS') btn = document.getElementById("btnDinasPulang");

  if (btn && btn.disabled) return; // sudah ada proses berjalan, abaikan klik ganda

  const originalContent = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-mini"></span> MEMPROSES...`;
  }

  let finalTipe = tipe;

  try {
    if (isDinas) {
      if (!navigator.geolocation) {
        throw new Error("Browser Anda tidak mendukung fitur GPS/Lokasi.");
      }
      let lat, lng;
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          });
        });
        lat = position.coords.latitude;
        lng = position.coords.longitude;
      } catch (err) {
        throw new Error("Izin lokasi (GPS) wajib diaktifkan untuk absen Dinas Luar!");
      }
      const lokasi = await showModernPrompt("Dinas Luar", `Masukkan lokasi/tujuan ${tipe} Anda:`, "text");
      if (!lokasi || lokasi.trim() === "") return;
      finalTipe = `${tipe} - ${lokasi.trim().toUpperCase()} [GPS: ${lat}, ${lng}]`;
    }

    const sekarang = new Date();
    const tglHariIni = getISODate(sekarang);

    // 1. Cek di antrean offline lokal dulu untuk menghindari duplikasi
    const offlineLogs = getOfflineLogs();
    const sudahAbsenOffline = offlineLogs.find(l =>
      l.nama === nama &&
      getISODate(new Date(l.waktu)) === tglHariIni &&
      l.status.startsWith(tipe)
    );
    if (sudahAbsenOffline) throw new Error(`Anda SUDAH absen ${tipe} hari ini (dalam antrean offline)!`);

    // 2. Cek di database server jika online
    if (navigator.onLine) {
      try {
        const { data: latestLogs, error: fetchErr } = await supabaseClient
          .from("logs")
          .select("nama, waktu, status")
          .eq("nama", nama)
          .order("id", { ascending: false })
          .limit(10);

        if (!fetchErr && latestLogs) {
          const sudahAbsen = latestLogs.find(l =>
            getISODate(new Date(l.waktu)) === tglHariIni &&
            l.status.startsWith(tipe)
          );
          if (sudahAbsen) throw new Error(`Anda SUDAH absen ${tipe} hari ini!`);
        }
      } catch (e) {
        console.warn("Gagal menghubungi server untuk cek duplikasi, melanjutkan absen offline-first.", e);
      }
    }

    const imageBase64 = capturePhoto();
    if (!imageBase64 && !isDinas) {
      throw new Error("Kamera belum siap atau izin kamera ditolak. Harap izinkan akses kamera!");
    }

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
      karyawan_id: info.id,
      waktu: toLocalISO(sekarang),
      status: finalTipe,
      foto: imageBase64,
      isLate: telat,
    };

    // 3. Jika offline, langsung simpan lokal
    if (!navigator.onLine) {
      saveOfflineLog(newLog);
      showModernAlert("BERHASIL (OFFLINE) ⚠️! Koneksi terputus, absen disimpan secara lokal di perangkat.", "warning");
      return;
    }

    // 4. Jika online, kirim ke server
    try {
      const { error } = await supabaseClient.from("logs").insert([newLog]);
      if (error) throw error;

      const namaDepan = info.nama.split(' ')[0];
      const isMasukType = tipe === 'MASUK' || tipe === 'DINAS LUAR';
      let successMsg;

      if (isMasukType && telat) {
        // Hitung sudah berapa kali telat masuk dalam minggu berjalan (Senin-Minggu ini)
        let jumlahTelatMingguIni = 1; // minimal diri sendiri hari ini
        try {
          const mondayStr = getMondayISO(sekarang);
          const { data: telatLogs, error: telatErr } = await supabaseClient
            .from("logs")
            .select("waktu")
            .eq("nama", nama)
            .eq("isLate", true)
            .gte("waktu", mondayStr + "T00:00:00")
            .or("status.ilike.MASUK%,status.ilike.DINAS LUAR%");
          if (!telatErr && telatLogs) jumlahTelatMingguIni = telatLogs.length;
        } catch (e) {
          console.warn("Gagal menghitung rekap telat mingguan:", e);
        }

        successMsg = `⚠️ Anda tercatat TERLAMBAT masuk hari ini.\nIni adalah keterlambatan ke-${jumlahTelatMingguIni} Anda minggu ini. Mohon lebih disiplin ya, ${namaDepan}!`;
      } else if (isMasukType) {
        successMsg = `${getSapaanWaktu(sekarang.getHours())}, ${namaDepan}! 👋\nAbsen masuk berhasil, selamat bekerja & semoga hari ini menyenangkan!`;
      } else {
        successMsg = `Sampai jumpa, ${namaDepan}! 🙏\nAbsen pulang berhasil, terima kasih atas kerja keras Anda hari ini.`;
      }

      showModernAlert(successMsg, telat ? "warning" : "success");
      await syncDataTerminal();
    } catch (dbErr) {
      console.warn("Gagal kirim ke database, menyimpan secara offline:", dbErr);
      saveOfflineLog(newLog);
      showModernAlert("BERHASIL (OFFLINE) ⚠️! Gagal mengirim ke server, absen disimpan secara lokal.", "warning");
    }

  } catch (err) {
    showModernAlert("GAGAL: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalContent;
      if (typeof lucide !== 'undefined') lucide.createIcons();
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
  const username = await showModernPrompt("Security Entry", "Masukkan Username Admin:", "text");
  if (username === null || username.trim() === "") return;

  const password = await showModernPrompt("Security Entry", "Masukkan Password Admin:", "password");
  if (password === null) return;

  try {
    const res = await fetch(`${SB_URL}/functions/v1/login-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || "Login gagal");

    localStorage.setItem("hris_token", result.token);
    localStorage.setItem("hris_admin_user", JSON.stringify(result.user));
    window.location.href = "admin.html";
  } catch (err) {
    showModernAlert(err.message, "error");
  }
}
