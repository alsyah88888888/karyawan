/**
 * KOBOI ADMIN - PREMIUM LOGIC
 * Manages statistics, employees, attendance logs, and payroll (including Overtime).
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";

// Token login admin (diterbitkan Edge Function login-admin) dilampirkan
// otomatis ke tiap request lewat accessToken callback ini - RLS di database
// membaca klaim di token ini untuk menentukan akses (bukan cuma tampilan).
const supabaseClient = supabase.createClient(SB_URL, SB_KEY, {
  accessToken: async () => localStorage.getItem("hris_token") || null,
});

// --- GUARD LOGIN ADMIN ---
// Sebelumnya admin.html bisa dibuka langsung tanpa password sama sekali.
// Sekarang wajib ada token valid (dari login-admin) sebelum halaman dipakai.
let ADMIN_USER = null;
let ACTIVE_COMPANY = localStorage.getItem("hris_active_company") || "ALL";

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function updateCompanyUI() {
  const compSelect = document.getElementById("selectActiveCompany");
  if (compSelect) {
    compSelect.value = ACTIVE_COMPANY;
  }

  const expComp = document.getElementById("exportSelectCompany");
  if (expComp) {
    if (ADMIN_USER?.company_access && ADMIN_USER.company_access !== "ALL") {
      expComp.value = ADMIN_USER.company_access;
      expComp.disabled = true;
    } else {
      expComp.value = ACTIVE_COMPANY;
      expComp.disabled = false;
    }
  }

  const badge = document.getElementById("sidebarCompanyBadge");
  if (badge) {
    if (ACTIVE_COMPANY === "PT. Kola Borasi Indonesia") {
      badge.innerText = "PT. Kola Borasi Indonesia";
    } else if (ACTIVE_COMPANY === "PT. Fortune Reef Zona") {
      badge.innerText = "PT. Fortune Reef Zona";
    } else if (ACTIVE_COMPANY === "Mitra Belanja") {
      badge.innerText = "Mitra Belanja";
    } else {
      badge.innerText = "Holding (Semua PT)";
    }
    badge.style.display = "inline-block";
  }
}

function onCompanyChange(comp) {
  if (ADMIN_USER?.company_access && ADMIN_USER.company_access !== "ALL") {
    ACTIVE_COMPANY = ADMIN_USER.company_access;
    updateCompanyUI();
    return;
  }
  ACTIVE_COMPANY = comp || "ALL";
  localStorage.setItem("hris_active_company", ACTIVE_COMPANY);
  updateCompanyUI();
  refreshUI();
}

function checkAdminAuthOrRedirect() {
  const token = localStorage.getItem("hris_token");
  const claims = token ? decodeJwtPayload(token) : null;
  const expired = !claims || !claims.exp || claims.exp * 1000 < Date.now();
  const isAdminRole = claims && (claims.app_role === "admin" || claims.app_role === "super_admin");

  if (!token || expired || !isAdminRole) {
    localStorage.removeItem("hris_token");
    localStorage.removeItem("hris_admin_user");
    window.location.href = "index.html";
    return false;
  }

  const storedAdmin = JSON.parse(localStorage.getItem("hris_admin_user") || "{}");
  ADMIN_USER = {
    ...storedAdmin,
    role: claims.app_role,
    company_access: claims.company_access || storedAdmin.company_access || "ALL"
  };

  // Konfigurasi akses perusahaan berdasarkan hak akses akun
  const compSelect = document.getElementById("selectActiveCompany");
  if (ADMIN_USER.company_access && ADMIN_USER.company_access !== "ALL") {
    ACTIVE_COMPANY = ADMIN_USER.company_access;
    if (compSelect) {
      compSelect.value = ACTIVE_COMPANY;
      compSelect.disabled = true;
      compSelect.title = `Akses akun Anda dibatasi khusus untuk ${ACTIVE_COMPANY}`;
    }
  } else {
    if (compSelect) {
      compSelect.disabled = false;
      compSelect.value = ACTIVE_COMPANY;
    }
  }
  updateCompanyUI();

  // Tab "Manajemen Admin" & "Audit Log" cuma untuk super_admin.
  const navSuperAdmin = document.getElementById("navSuperAdminOnly");
  if (navSuperAdmin) navSuperAdmin.style.display = claims.app_role === "super_admin" ? "block" : "none";

  return true;
}

function logoutAdmin() {
  localStorage.removeItem("hris_token");
  localStorage.removeItem("hris_admin_user");
  window.location.href = "index.html";
}

// --- MANAJEMEN AKUN ADMIN (super_admin only - dijaga RLS + RPC di database) ---
function showCreateAdminModal() {
  document.getElementById("inpNewAdminNama").value = "";
  document.getElementById("inpNewAdminUsername").value = "";
  document.getElementById("inpNewAdminPassword").value = "";
  document.getElementById("inpNewAdminRole").value = "admin";
  const compEl = document.getElementById("inpNewAdminCompany");
  if (compEl) compEl.value = "ALL";
  document.getElementById("modalCreateAdmin").style.display = "flex";
}

async function createAdminAccount() {
  const nama = document.getElementById("inpNewAdminNama").value.trim();
  const username = document.getElementById("inpNewAdminUsername").value.trim();
  const password = document.getElementById("inpNewAdminPassword").value;
  const role = document.getElementById("inpNewAdminRole").value;
  const companyAccess = document.getElementById("inpNewAdminCompany")?.value || "ALL";

  if (!nama || !username || !password) return alert("Harap isi semua data!");
  if (password.length < 6) return alert("Password minimal 6 karakter!");

  showLoading(true);
  try {
    let { error } = await supabaseClient.rpc("admin_create_account", {
      p_username: username,
      p_password: password,
      p_nama: nama,
      p_role: role,
      p_company_access: companyAccess,
    });
    // Fallback jika migration Postgres belum dijalankan
    if (error && (error.message.includes("p_company_access") || error.code === "42883")) {
      const resFallback = await supabaseClient.rpc("admin_create_account", {
        p_username: username,
        p_password: password,
        p_nama: nama,
        p_role: role,
      });
      error = resFallback.error;
    }
    if (error) throw error;

    document.getElementById("modalCreateAdmin").style.display = "none";
    showToast("Akun admin berhasil dibuat", "success");
    logAudit("Tambah Akun Admin", `Membuat akun ${username} (${role}, ${companyAccess})`);
    renderAdminAccounts();
  } catch (err) {
    showToast("Gagal: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function renderAdminAccounts() {
  const body = document.getElementById("adminAccountsBody");
  if (!body) return;

  let { data, error } = await supabaseClient
    .from("admin_accounts")
    .select("id, username, nama, role, company_access, is_active, last_login_at")
    .order("id", { ascending: true });

  if (error) {
    const fb = await supabaseClient
      .from("admin_accounts")
      .select("id, username, nama, role, is_active, last_login_at")
      .order("id", { ascending: true });
    if (fb.error) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">Gagal memuat data: ${error.message}</td></tr>`;
      return;
    }
    data = fb.data;
  }

  body.innerHTML = (data || []).map((a) => `
    <tr>
      <td>${escapeHtml(a.username)}</td>
      <td>${escapeHtml(a.nama)}</td>
      <td><span class="badge">${a.role === "super_admin" ? "SUPER ADMIN" : "ADMIN"}</span></td>
      <td><span class="badge" style="background:#eef2ff; color:#4f46e5; font-weight:700;">${a.company_access || "ALL"}</span></td>
      <td>${a.is_active ? '<span style="color:var(--success); font-weight:700;">Aktif</span>' : '<span style="color:var(--danger); font-weight:700;">Nonaktif</span>'}</td>
      <td>${a.last_login_at ? new Date(a.last_login_at).toLocaleString("id-ID") : "-"}</td>
      <td>
        <button class="btn btn-outline btn-small" onclick="toggleAdminActive(${a.id}, ${!a.is_active})">
          ${a.is_active ? "Nonaktifkan" : "Aktifkan"}
        </button>
        <button class="btn btn-outline btn-small" onclick="changeAdminPassword(${a.id}, '${escapeHtml(a.username)}')">
          Ganti Password
        </button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-muted);">Belum ada akun admin lain.</td></tr>`;
}

// module_key -> id link sidebar yang harus disembunyikan dari role "admin"
// kalau modulnya dimatikan (RLS di database tetap penjaga sesungguhnya - ini
// cuma UX supaya admin tidak lihat tab yang datanya akan ditolak).
const MODULE_NAV_LINKS = {
  leave_management: ["linkTabLeave"],
  performance_kpi: ["linkTabPerformance"],
  ceo_access: ["linkTabCEO"],
};

let MODULE_SETTINGS_CACHE = [];

// Dipanggil sekali saat halaman dimuat (window.onload) - untuk role "admin"
// sembunyikan link tab yang modulnya dimatikan Super Admin. super_admin
// selalu lihat semua link, tidak pernah disembunyikan oleh setting ini.
async function applyModuleVisibility() {
  if (!ADMIN_USER || ADMIN_USER.role === "super_admin") return;

  const { data, error } = await supabaseClient
    .from("admin_module_settings")
    .select("module_key, enabled_for_admin");
  if (error) return;

  MODULE_SETTINGS_CACHE = data || [];
  for (const row of MODULE_SETTINGS_CACHE) {
    if (row.enabled_for_admin) continue;
    const links = MODULE_NAV_LINKS[row.module_key] || [];
    links.forEach((linkId) => {
      const el = document.getElementById(linkId);
      if (el) el.style.display = "none";
    });
  }
}

function isModuleEnabledForCurrentAdmin(moduleKey) {
  if (!ADMIN_USER || ADMIN_USER.role === "super_admin") return true;
  const row = MODULE_SETTINGS_CACHE.find((r) => r.module_key === moduleKey);
  return row ? row.enabled_for_admin : true;
}

async function renderModuleSettings() {
  const body = document.getElementById("moduleSettingsBody");
  if (!body) return;

  const { data, error } = await supabaseClient
    .from("admin_module_settings")
    .select("module_key, label, enabled_for_admin")
    .order("module_key", { ascending: true });

  if (error) {
    body.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:2rem; color:var(--text-muted);">Gagal memuat: ${error.message}</td></tr>`;
    return;
  }

  body.innerHTML = (data || []).map((m) => `
    <tr>
      <td>${escapeHtml(m.label)}</td>
      <td>${m.enabled_for_admin ? '<span style="color:var(--success); font-weight:700;">Aktif untuk Admin</span>' : '<span style="color:var(--danger); font-weight:700;">Dimatikan untuk Admin</span>'}</td>
      <td>
        <button class="btn btn-outline btn-small" onclick="toggleModuleSetting('${m.module_key}', ${!m.enabled_for_admin})">
          ${m.enabled_for_admin ? "Matikan" : "Aktifkan"}
        </button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="3" style="text-align:center; padding:2rem; color:var(--text-muted);">Tidak ada modul yang bisa diatur.</td></tr>`;
}

async function toggleModuleSetting(moduleKey, setEnabled) {
  showLoading(true);
  try {
    const { error } = await supabaseClient
      .from("admin_module_settings")
      .update({ enabled_for_admin: setEnabled, updated_at: new Date().toISOString(), updated_by: ADMIN_USER?.id || null })
      .eq("module_key", moduleKey);
    if (error) throw error;
    showToast(setEnabled ? "Modul diaktifkan untuk role Admin" : "Modul dimatikan untuk role Admin", "success");
    logAudit(setEnabled ? "Aktifkan Modul" : "Matikan Modul", `admin_module_settings.module_key=${moduleKey}`);
    renderModuleSettings();
  } catch (err) {
    showToast("Gagal: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function toggleAdminActive(id, setActive) {
  if (ADMIN_USER && String(ADMIN_USER.id) === String(id) && !setActive) {
    return alert("Tidak bisa menonaktifkan akun yang sedang Anda pakai sendiri.");
  }
  showLoading(true);
  try {
    const { error } = await supabaseClient.from("admin_accounts").update({ is_active: setActive }).eq("id", id);
    if (error) throw error;
    showToast(setActive ? "Akun diaktifkan" : "Akun dinonaktifkan", "success");
    logAudit(setActive ? "Aktifkan Akun Admin" : "Nonaktifkan Akun Admin", `admin_accounts.id=${id}`);
    renderAdminAccounts();
  } catch (err) {
    showToast("Gagal: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

// super_admin bisa ganti password akun siapa saja; admin biasa cuma bisa
// ganti password miliknya sendiri (dijaga di RPC admin_change_password, jadi
// walau tombol ini tampil di semua baris, RPC akan menolak kalau tidak berhak).
async function changeAdminPassword(id, username) {
  const newPassword = window.prompt(`Password baru untuk akun "${username}" (minimal 6 karakter):`);
  if (newPassword === null) return;
  if (newPassword.length < 6) return alert("Password minimal 6 karakter!");

  showLoading(true);
  try {
    const { error } = await supabaseClient.rpc("admin_change_password", {
      p_admin_id: id,
      p_new_password: newPassword,
    });
    if (error) throw error;
    showToast(`Password akun "${username}" berhasil diganti`, "success");
    logAudit("Ganti Password Admin", `admin_accounts.id=${id} (${username})`);
  } catch (err) {
    showToast("Gagal: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function renderAuditLog() {
  const body = document.getElementById("auditLogBody");
  if (!body) return;

  const { data, error } = await supabaseClient
    .from("audit_logs")
    .select("*")
    .order("id", { ascending: false })
    .limit(200);

  if (error) {
    body.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-muted);">Gagal memuat data: ${error.message}</td></tr>`;
    return;
  }

  body.innerHTML = (data || []).map((l) => `
    <tr>
      <td>${l.created_at ? new Date(l.created_at).toLocaleString("id-ID") : "-"}</td>
      <td>${l.actor_name || "-"} <span style="color:var(--text-muted); font-size:0.7rem;">(${l.actor_type || "-"})</span></td>
      <td>${l.action}</td>
      <td style="color:var(--text-muted); font-size:0.8rem;">${l.details || "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-muted);">Belum ada aktivitas tercatat.</td></tr>`;
}

const STANDAR_MASUK = 9; // Jam 9 Pagi
const STANDAR_PULANG = 18; // Jam 6 Sore
const TARIF_LEMBUR = 10000; // Rp 10.000 per jam (Sesuai gambar user)
const TARIF_HKE = 50000; // Rp 50.000 per hari (Sesuai gambar user: 6 hari = 300rb)
const TOLERANSI_MASUK_MENIT = 15; // Sampai 09:15 tetap tidak telat

let KARYAWAN = [];
let logs = [];
let allLogs = [];
let CEO_PHONE = "6285774444805"; // Nomor WA CEO PT. Kola Borasi Indonesia
let INCENTIVE_APPROVED = true; // Status Persetujuan CEO

// KPI CONFIGURATION LIBRARY
const KPI_LIBRARY = {
  "OFFICE": {
    "ADMIN": ["Ketepatan Laporan (SLA)", "Akurasi Input Data", "Kerapihan Arsip", "Kecepatan Respon"],
    "FINANCE": ["Ketelitian Rekonsiliasi", "Ketepatan Waktu Laporan", "Audit Compliance", "Manajemen Kas"],
    "DEFAULT": ["Kualitas Kerja", "Inisiatif", "Kedisiplinan", "Teamwork"]
  },
  "OPERASIONAL": {
    "DRIVER": ["Ketepatan Waktu Kirim", "Safety & Eco-Driving", "Kebersihan Unit", "Efisiensi BBM"],
    "HELPER": ["Kecepatan Bongkar Muat", "Keutuhan Barang", "Kerapihan Gudang", "Kerjasama Tim"],
    "DEFAULT": ["Efisiensi Kerja", "Sikap/Attitude", "Tanggung Jawab", "Keamanan Kerja"]
  },
  "SALES": {
    "DEFAULT": ["Pencapaian Target", "Jumlah Kunjungan", "Retensi Pelanggan", "Sikap/Pelayanan"]
  },
  "DEFAULT": ["Kualitas Kerja", "Inisiatif", "Sikap", "Tanggung Jawab"]
};

// Chart Instances
let punctualityChartInstance = null;
let attendanceChartInstance = null;

// Daftar NIK yang memiliki file ID card fisik statis di direktori image/
const EXISTING_CARD_NIKS = new Set([
  'KBI-000001', 'KBI-101109', 'KBI-108647', 'KBI-110626', 'KBI-131504',
  'KBI-158977', 'KBI-199021', 'KBI-290326', 'KBI-318648', 'KBI-352053',
  'KBI-365053', 'KBI-409184', 'KBI-438007', 'KBI-513115', 'KBI-543833',
  'KBI-546731', 'KBI-600830', 'KBI-732248'
]);

function getEmployeeAvatar(k) {
  if (!k) return 'https://ui-avatars.com/api/?name=?&background=e2e8f0&color=94a3b8';
  if (k.foto_url) return k.foto_url;
  const nik = (k.nik || '').trim();
  if (nik && EXISTING_CARD_NIKS.has(nik)) {
    return `image/NAME CARD KOLA BORASI INDONESIA/${nik}.png`;
  }
  const name = encodeURIComponent((k.nama || 'User').trim());
  return `https://ui-avatars.com/api/?name=${name}&background=4f46e5&color=fff&bold=true`;
}

function getCompanyOfKaryawan(k) {
  if (k && k.perusahaan && typeof k.perusahaan === "string" && k.perusahaan.trim()) {
    return k.perusahaan.trim();
  }
  const nik = (k?.nik || "").trim().toUpperCase();
  const nama = (k?.nama || "").trim().toUpperCase();
  if (nik.startsWith("FRZ-") || ["LUTVI ABDULAH", "SELI MARYANI", "JOSAFAT TEGUH IMAN SINAGA"].includes(nama)) {
    return "PT. Fortune Reef Zona";
  }
  if (nik.startsWith("MB-")) {
    return "Mitra Belanja";
  }
  return "PT. Kola Borasi Indonesia";
}

function getCompanyBranding(k) {
  const comp = getCompanyOfKaryawan(k);
  if (comp === "PT. Fortune Reef Zona") {
    return {
      name: "PT. FORTUNE REEF ZONA",
      address: "Sentra Bisnis Fortune, Kawasan Niaga & Distribusi, Bogor",
      logo: "logokoboi.png"
    };
  } else if (comp === "Mitra Belanja") {
    return {
      name: "MITRA BELANJA",
      address: "Pusat Distribusi & Retail Mitra Belanja",
      logo: "logokoboi.png"
    };
  }
  return {
    name: "PT. KOLA BORASI INDONESIA",
    address: "Green Kartika Residence Blok EE No.2, Cibinong, Bogor",
    logo: "logokoboi.png"
  };
}

function getFilteredKaryawan() {
  if (!ACTIVE_COMPANY || ACTIVE_COMPANY === "ALL") {
    return KARYAWAN;
  }
  return KARYAWAN.filter(k => getCompanyOfKaryawan(k) === ACTIVE_COMPANY);
}

function getFilteredLogs() {
  if (!ACTIVE_COMPANY || ACTIVE_COMPANY === "ALL") {
    return allLogs;
  }
  const allowedNames = new Set(getFilteredKaryawan().map(k => (k.nama || "").trim().toLowerCase()));
  return allLogs.filter(l => allowedNames.has((l.nama || "").trim().toLowerCase()));
}

// --- CORE SYNC ---
async function syncData() {
  // Set Default Periode: Seminggu Terakhir (H-7 s/d H-1)
  if (!document.getElementById("filterTglMulai").value) setPeriodeSemingguTerakhir();
  if (!document.getElementById("kpiFilterTglMulai").value) setPeriodeKPI('ini');
  if (!document.getElementById("logFilterTglMulai").value) {
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - 7);
    const end = new Date(now); end.setDate(now.getDate() - 1);
    document.getElementById("logFilterTglMulai").value = start.toISOString().split('T')[0];
    document.getElementById("logFilterTglSelesai").value = end.toISOString().split('T')[0];
  }

  // Inisialisasi default filter ekspor (Januari s/d Sekarang)
  const nowYear = new Date().getFullYear();
  const todayDateStr = toLocalISO(new Date()).split('T')[0];
  const expMulaiEl = document.getElementById("exportTglMulai");
  const expSelesaiEl = document.getElementById("exportTglSelesai");
  if (expMulaiEl && !expMulaiEl.value) expMulaiEl.value = `${nowYear}-01-01`;
  if (expSelesaiEl && !expSelesaiEl.value) expSelesaiEl.value = todayDateStr;

  // Set default tab to dashboard if none active
  if (!document.querySelector(".nav-link.active")) switchTab('tabDashboard');

  showLoading(true);
  try {
    const { data: dataKar, error: errK } = await supabaseClient.from("karyawan").select("*").order("nama", { ascending: true });
    if (errK) throw errK;
    KARYAWAN = dataKar || [];

    // OPTIMASI: Deteksi filter mana yang aktif (Global vs Log Tab)
    const isLogTab = document.getElementById("tabLog")?.style.display !== "none";
    
    const tglMulai = isLogTab 
      ? document.getElementById("logFilterTglMulai")?.value 
      : document.getElementById("filterTglMulai")?.value;
      
    const tglSelesai = isLogTab 
      ? document.getElementById("logFilterTglSelesai")?.value 
      : document.getElementById("filterTglSelesai")?.value;

    if (tglMulai && tglSelesai) {
      const todayStr = toLocalISO(new Date()).split('T')[0];
      const tglSelesaiEfektif = tglSelesai < todayStr ? todayStr : tglSelesai;

      // Ambil seluruh log dengan batch pagination agar tidak terpotong 1.000 limit Supabase
      const fetched = await fetchAllLogsInRange(tglMulai, tglSelesaiEfektif);
      allLogs = fetched.sort((a, b) => new Date(b.waktu) - new Date(a.waktu));
    } else {
      // Fallback: Ambil data 30 hari terakhir
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      const fetched = await fetchAllLogsInRange(toLocalISO(thirtyDaysAgo).split('T')[0], toLocalISO(now).split('T')[0]);
      allLogs = fetched.sort((a, b) => new Date(b.waktu) - new Date(a.waktu));
    }

    // logs untuk tampilan tabel log
    logs = allLogs;

    refreshUI();
    showToast("Data berhasil disinkronkan", "success");
  } catch (e) {
    showToast("Sync Gagal: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

function refreshUI() {
  updateCompanyUI();
  renderStats();
  renderLogTable();
  renderKaryawanTable();
  renderCEOTable();
  renderVisualStats();
  renderKPITable();
  renderCalendar();
  if (document.getElementById("tabLeave")?.style.display === "block") fetchLeaveRequests();
  if (document.getElementById("tabPerformance")?.style.display === "block") { fetchReviews(); loadKpiRollup("weekly"); }
}

// --- DASHBOARD UI ---
function renderStats() {
  const manpowerEl = document.getElementById("statManpower");
  const hadirEl = document.getElementById("statHadir");
  const tidakMasukEl = document.getElementById("statTidakMasuk");
  const terlambatEl = document.getElementById("statTerlambat");
  const avgAttEl = document.getElementById("statAvgAttendance");

  const filteredK = getFilteredKaryawan();
  const fLogs = getFilteredLogs();

  if (manpowerEl) manpowerEl.innerText = filteredK.length;

  const todayStr = new Date().toLocaleDateString();
  const logsToday = fLogs.filter(l => new Date(l.waktu).toLocaleDateString() === todayStr);

  const uniqueHadir = [...new Set(logsToday.filter(l => isMasukStatus(l.status)).map(l => l.nama))].length;
  const totalTelat = logsToday.filter(l => isMasukStatus(l.status) && (l.isLate === true || l.isLate === "true")).length;
  const totalTidakMasuk = Math.max(0, filteredK.length - uniqueHadir);

  if (hadirEl) hadirEl.innerText = uniqueHadir;
  if (tidakMasukEl) tidakMasukEl.innerText = totalTidakMasuk;
  if (terlambatEl) terlambatEl.innerText = totalTelat;

  // Rata-rata Kehadiran Perusahaan Periode Ini
  let totalRate = 0;
  filteredK.forEach(k => {
    const d = hitungDetailGaji(k.gaji, k.nama);
    const rate = ((d.hadir / d.totalHariKerja) * 100) || 0;
    totalRate += rate;
  });
  const avgRate = filteredK.length > 0 ? (totalRate / filteredK.length) : 0;
  if (avgAttEl) avgAttEl.innerText = avgRate.toFixed(1) + "%";
}

function renderVisualStats() {
  const fLogs = getFilteredLogs();

  // 1. Chart Analisis Kedisiplinan (Punctuality)
  const punctCtx = document.getElementById('punctualityChart')?.getContext('2d');
  if (punctCtx) {
    const onTime = fLogs.filter(l => isMasukStatus(l.status) && !l.isLate).length;
    const late = fLogs.filter(l => isMasukStatus(l.status) && (l.isLate === true || l.isLate === "true")).length;

    if (punctualityChartInstance) punctualityChartInstance.destroy();
    punctualityChartInstance = new Chart(punctCtx, {
      type: 'pie',
      data: {
        labels: ['Tepat Waktu', 'Terlambat'],
        datasets: [{
          data: [onTime, late],
          backgroundColor: ['#10b981', '#ef4444'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, font: { family: 'Outfit', size: 11 } } }
        }
      }
    });
  }

  // 2. Chart Tren Kehadiran (7 Hari Terakhir)
  const attCtx = document.getElementById('attendanceChart')?.getContext('2d');
  if (attCtx) {
    const days = [];
    const counts = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString();
      days.push(d.toLocaleDateString('id-ID', { weekday: 'short' }));

      const uniqueAtDay = [...new Set(fLogs.filter(l =>
        new Date(l.waktu).toLocaleDateString() === dateStr && isMasukStatus(l.status)
      ).map(l => l.nama))].length;

      counts.push(uniqueAtDay);
    }

    if (attendanceChartInstance) attendanceChartInstance.destroy();
    attendanceChartInstance = new Chart(attCtx, {
      type: 'line',
      data: {
        labels: days,
        datasets: [{
          label: 'Jumlah Karyawan Masuk',
          data: counts,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#4f46e5'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { display: false }, ticks: { stepSize: 1, font: { family: 'Outfit' } } },
          x: { grid: { display: false }, ticks: { font: { family: 'Outfit' } } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}

function switchTab(tab) {
  const tabs = ["tabDashboard", "tabLog", "tabKaryawan", "tabLeave", "tabPerformance", "tabCEO", "tabCalendar", "tabAccounts", "tabAudit"];
  tabs.forEach((t) => {
    const el = document.getElementById(t);
    if (el) el.style.display = t === tab ? "block" : "none";
  });

  // Update Sidebar Active States
  const links = ["linkTabDashboard", "linkTabLog", "linkTabKaryawan", "linkTabLeave", "linkTabPerformance", "linkTabCEO", "linkTabCalendar", "linkTabAccounts", "linkTabAudit"];
  links.forEach(l => {
    const el = document.getElementById(l);
    if (el) el.classList.toggle("active", l.includes(tab.replace('tab', '')));
  });

  const tabModuleMap = { tabLeave: "leave_management", tabPerformance: "performance_kpi", tabCEO: "ceo_access" };
  if (tabModuleMap[tab] && !isModuleEnabledForCurrentAdmin(tabModuleMap[tab])) {
    showToast("Modul ini dimatikan untuk akun Anda oleh Super Admin", "error");
    tab = "tabDashboard";
    tabs.forEach((t) => {
      const el = document.getElementById(t);
      if (el) el.style.display = t === tab ? "block" : "none";
    });
  }

  if (tab === "tabLog" || tab === "tabKaryawan") syncData();
  if (tab === "tabLeave") fetchLeaveRequests();
  if (tab === "tabPerformance") { fetchReviews(); loadKpiRollup("weekly"); }
  if (tab === "tabCalendar") renderCalendar();
  if (tab === "tabAccounts") { renderAdminAccounts(); renderModuleSettings(); }
  if (tab === "tabAudit") renderAuditLog();

  const title = document.getElementById("pageTitle");
  if (title) {
    if (tab === "tabDashboard") title.innerText = "Executive Dashboard";
    else if (tab === "tabLog") title.innerText = "Log Absensi Real-time";
    else if (tab === "tabCEO") title.innerText = "Direksi / CEO Panel";
    else if (tab === "tabPerformance") title.innerText = "Penilaian Performa (KPI & OKR)";
    else if (tab === "tabLeave") title.innerText = "Inbox Pengajuan Cuti";
    else if (tab === "tabAccounts") title.innerText = "Manajemen Akun Admin";
    else if (tab === "tabAudit") title.innerText = "Audit Log";
    else title.innerText = "Manajemen Karyawan";
  }

  setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 50);

  if (typeof lucide !== 'undefined') lucide.createIcons();

  const sidebar = document.getElementById("mainSidebar");
  if (sidebar) sidebar.classList.remove("active");
}

function renderKPITable() {
  const body = document.getElementById("kpiTableBody");
  if (!body) return;

  const customStart = document.getElementById("kpiFilterTglMulai")?.value;
  const customEnd = document.getElementById("kpiFilterTglSelesai")?.value;
  const fLogs = getFilteredLogs();

  let htmlRows = "";
  const filteredK = getFilteredKaryawan();
  filteredK.forEach(k => {
    const d = hitungDetailGaji(k.gaji, k.nama, customStart, customEnd);

    // Perhitungan KPI
    const attendanceRate = ((d.hadir / d.totalHariKerja) * 100) || 0;

    let logsKar = fLogs.filter(l => (l.nama || '').trim().toLowerCase() === k.nama.trim().toLowerCase() && isMasukStatus(l.status));

    // Filter logs berdasarkan tanggal dashboard
    if (customStart && customEnd) {
      const start = new Date(customStart + "T00:00:00");
      const end = new Date(customEnd + "T23:59:59");
      logsKar = logsKar.filter(l => {
        const w = new Date(l.waktu);
        return w >= start && w <= end;
      });
    }

    const lateCount = logsKar.filter(l => l.isLate === true || l.isLate === "true").length;

    // Status Performa
    let statusLabel = "GOOD";
    let statusClass = "badge-success";

    if (attendanceRate >= 95 && lateCount === 0) {
      statusLabel = "EXCELLENT";
      statusClass = "badge-success";
    } else if (attendanceRate >= 85 && lateCount <= 2) {
      statusLabel = "GOOD";
      statusClass = "badge-success";
    } else if (attendanceRate >= 75 || lateCount <= 4) {
      statusLabel = "AVERAGE";
      statusClass = "badge-warning";
    } else {
      statusLabel = "NEED IMPROVEMENT";
      statusClass = "badge-danger";
    }

    htmlRows += `
      <tr>
        <td>
          <div style="font-weight: 700;">${k.nama}</div>
          <div style="font-size: 0.7rem; color: var(--text-muted);">${k.jabatan || "-"} <span style="color:var(--primary); font-weight:600;">(${getCompanyOfKaryawan(k)})</span></div>
        </td>
        <td><span class="badge" style="background: #f1f5f9; color: #475569;">${k.dept}</span></td>
        <td>
          <div style="font-weight: 800; color: ${attendanceRate < 80 ? 'var(--danger)' : 'var(--text-main)'}">
            ${attendanceRate.toFixed(1)}%
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted);">${d.hadir} / ${d.totalHariKerja} Hari</div>
        </td>
        <td style="font-weight: 700; color: ${lateCount > 0 ? 'var(--danger)' : 'var(--success)'}">
          ${lateCount} Kali
        </td>
        <td>
          <div style="font-weight: 700;">${d.totalLembur} Jam</div>
        </td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
}

function renderCEOTable() {
  const body = document.getElementById("ceoTableBody");
  if (!body) return;

  let htmlRows = "";
  const filteredK = getFilteredKaryawan();
  filteredK.forEach((k) => {
    const masterInsentif = (parseFloat(k.incentive) || 0) + (parseFloat(k.incentive_luar) || 0);
    const approvedVal = parseFloat(k.incentive_approved_val) || 0;
    const isApproved = k.is_incentive_approved === true;

    htmlRows += `
      <tr>
        <td>
          <div style="font-weight: 700;">${k.nama}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${k.dept} <span style="font-size:0.7rem; color:var(--primary); font-weight:700;">• ${getCompanyOfKaryawan(k)}</span></div>
        </td>
        <td>Rp ${masterInsentif.toLocaleString('id-ID')}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">Rp</span>
            <input type="number" id="valInsentifCEO_${k.id}" class="form-input" 
                   value="${isApproved ? approvedVal : masterInsentif}" 
                   style="width: 150px; padding: 5px 10px; font-weight: 800; color: var(--primary);">
          </div>
        </td>
        <td>
          <span class="badge ${isApproved ? 'badge-success' : 'badge-warning'}">
            ${isApproved ? 'DISETUJUI CEO' : 'MENUNGGU'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary btn-small" onclick="simpanIncentiveCEO('${k.id}')">
                Setujui Nominal
            </button>
            ${isApproved ? `<button class="btn btn-danger btn-small" onclick="batalkanIncentiveCEO('${k.id}')">Batalkan</button>` : ''}
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
}

async function simpanIncentiveCEO(kId) {
  const k = KARYAWAN.find(x => String(x.id) === String(kId));
  if (!k) return;
  const inputVal = document.getElementById(`valInsentifCEO_${k.id}`)?.value;
  const nominal = parseFloat(inputVal) || 0;

  if (nominal < 0) return alert("Nominal tidak boleh negatif!");

  const { error } = await supabaseClient
    .from("karyawan")
    .update({
      is_incentive_approved: true,
      incentive_approved_val: nominal
    })
    .eq("id", k.id);

  if (!error) {
    alert(`Insentif ${k.nama} disetujui sebesar Rp ${nominal.toLocaleString('id-ID')}`);
    syncData();
  } else {
    alert("Gagal menyimpan: " + error.message);
  }
}

async function batalkanIncentiveCEO(kId) {
  const k = KARYAWAN.find(x => String(x.id) === String(kId));
  if (!k) return;
  const { error } = await supabaseClient
    .from("karyawan")
    .update({ is_incentive_approved: false })
    .eq("id", k.id);

  if (!error) {
    syncData();
  }
}

function toggleSidebar() { document.getElementById("sidebar").classList.toggle("active"); }

function renderLogTable() {
  const body = document.getElementById("logTableBody");
  const searchInput = document.getElementById("logSearchInput")?.value.toLowerCase() || "";
  const statusFilter = document.getElementById("logFilterStatus")?.value || "ALL";
  if (!body) return;

  let htmlRows = "";
  const fLogs = getFilteredLogs();
  const targetKaryawan = getFilteredKaryawan();

  // Filter logs berdasarkan input pencarian nama
  const filteredLogs = fLogs.filter(l => (l.nama || '').toLowerCase().includes(searchInput));

  let total = 0;
  let tepat = 0;
  let telat = 0;

  filteredLogs.forEach((l) => {
    total++;
    const isLate = l.isLate === true || l.isLate === "true" || l.is_late === true;
    const isMasuk = isMasukStatus(l.status);
    if (isMasuk) {
      if (isLate) telat++; else tepat++;
    }
  });

  // Tentukan karyawan yang belum absen (Tidak Masuk)
  const tglMulai = document.getElementById("logFilterTglMulai")?.value;
  const todayStr = toLocalISO(new Date()).split('T')[0];
  const activeDate = tglMulai || todayStr;

  const hadirNames = new Set(
    fLogs
      .filter(l => isMasukStatus(l.status))
      .map(l => (l.nama || "").trim().toLowerCase())
  );

  const absentEmployees = targetKaryawan.filter(k => 
    !hadirNames.has((k.nama || "").trim().toLowerCase()) &&
    (!searchInput || (k.nama || "").toLowerCase().includes(searchInput))
  );

  const totalTidakMasuk = absentEmployees.length;

  // Update Summary Cards
  const totalEl = document.getElementById("logStatTotal");
  const tepatEl = document.getElementById("logStatTepat");
  const telatEl = document.getElementById("logStatTelat");
  const tidakMasukEl = document.getElementById("logStatTidakMasuk");
  if (totalEl) totalEl.innerText = total;
  if (tepatEl) tepatEl.innerText = tepat;
  if (telatEl) telatEl.innerText = telat;
  if (tidakMasukEl) tidakMasukEl.innerText = totalTidakMasuk;

  // Filter log yang akan ditampilkan ke tabel sesuai dropdown Status
  let logsToRender = filteredLogs;
  if (statusFilter === "TEPAT") {
    logsToRender = filteredLogs.filter(l => isMasukStatus(l.status) && !(l.isLate === true || l.isLate === "true" || l.is_late === true));
  } else if (statusFilter === "TELAT") {
    logsToRender = filteredLogs.filter(l => (l.isLate === true || l.isLate === "true" || l.is_late === true));
  } else if (statusFilter === "TIDAK_MASUK") {
    logsToRender = filteredLogs.filter(l => {
      const s = (l.status || "").toUpperCase();
      return s.includes("TIDAK MASUK") || s.includes("ALPHA") || s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI");
    });
  }

  const displayLogs = logsToRender.slice(0, 200);

  // Jika status filter TIDAK_MASUK, sertakan karyawan yang belum absen sama sekali
  if (statusFilter === "TIDAK_MASUK") {
    absentEmployees.forEach((k) => {
      const initials = (k.nama || "").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
      const compName = getCompanyOfKaryawan(k);
      htmlRows += `
        <tr class="row-absent" style="background: #fff8f8;">
          <td>
            <div class="emp-info">
              <div class="emp-avatar" style="background: #fee2e2; color: #dc2626; font-weight: 800;">${escapeHtml(initials)}</div>
              <div>
                <div style="font-weight: 700; color: #991b1b; font-size: 0.9rem;">${escapeHtml(k.nama)}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">${escapeHtml(compName)} • ${escapeHtml(k.dept || "GENERAL")} • ${escapeHtml(k.jabatan || "-")}</div>
              </div>
            </div>
          </td>
          <td>
            <div class="log-status-cell">
              <span class="badge badge-danger">
                <i data-lucide="user-x" style="width:12px; height:12px;"></i>
                TIDAK MASUK (ALPHA)
              </span>
            </div>
          </td>
          <td>
            <div class="log-time" style="color: #dc2626; font-weight: 700;">Belum Absen</div>
            <div class="log-date">${escapeHtml(activeDate)}</div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:6px; color:#dc2626; font-size:0.75rem; font-weight:700;">
              <i data-lucide="alert-triangle" style="width:14px; height:14px; flex-shrink:0;"></i> Belum ada rekaman absensi masuk
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">Karyawan belum tap absen / Alpha untuk shift ini</div>
          </td>
          <td>
            <button class="btn btn-primary btn-small" style="padding: 5px 12px; font-size: 0.75rem; background: #dc2626; border-color: #dc2626;" onclick="bukaInputManualKaryawan('${escapeHtml(k.nama)}', '${activeDate}')">
              <i data-lucide="plus-circle" style="width:13px; height:13px; vertical-align:middle; margin-right:3px;"></i> Catat
            </button>
          </td>
        </tr>`;
    });
  }

  displayLogs.forEach((l) => {
    const isLate = l.isLate === true || l.isLate === "true" || l.is_late === true;
    const s = (l.status || "").toUpperCase();
    let badgeClass = "badge-masuk";
    let icon = "log-in";

    if (s.includes("PULANG")) {
      badgeClass = "badge-pulang";
      icon = "log-out";
    } else if (s.includes("DINAS")) {
      badgeClass = "badge-dinas";
      icon = "briefcase";
    } else if (s.includes("TIDAK MASUK") || s.includes("ALPHA")) {
      badgeClass = "badge-danger";
      icon = "user-x";
    } else if (s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI")) {
      badgeClass = "badge-warning";
      icon = "file-text";
    }

    const tgl = new Date(l.waktu);
    const initials = (l.nama || "").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
    const lateInfo = hitungDetailKeterlambatan(l);
    const isMasuk = isMasukStatus(l.status);

    let displayStatus = l.status;
    let gpsLink = "";
    if (l.status && l.status.includes("[GPS:")) {
        const gpsMatch = l.status.match(/\[GPS:\s*([^\]]+)\]/);
        if (gpsMatch) {
            const coords = gpsMatch[1];
            gpsLink = `<a href="https://maps.google.com/?q=${coords}" target="_blank" style="display:inline-block; margin-top:4px; color:#2563eb; text-decoration:none; font-size:0.75rem; font-weight:700;"><i data-lucide="map-pin" style="width:12px; height:12px; vertical-align:middle;"></i> Buka di Maps</a>`;
            displayStatus = l.status.replace(/\[GPS:.*?\]/, "").trim();
        }
    }

    const isNonMasukState = s.includes("TIDAK MASUK") || s.includes("ALPHA") || s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI");

    htmlRows += `
      <tr class="${lateInfo.isLate ? 'row-late' : (isNonMasukState ? 'row-absent' : '')}">
        <td>
          <div class="emp-info">
            <div class="emp-avatar">${escapeHtml(initials)}</div>
            <div>
              <div style="font-weight: 700; color: var(--sidebar-bg); font-size: 0.9rem;">${escapeHtml(l.nama)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">${escapeHtml(l.dept || "GENERAL")}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="log-status-cell">
            <span class="badge ${badgeClass}">
              <i data-lucide="${icon}" style="width:12px; height:12px;"></i>
              ${escapeHtml(displayStatus)}
            </span>
            ${gpsLink ? `<br>${gpsLink}` : ''}
          </div>
        </td>
        <td>
          <div class="log-time">${tgl.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
          <div class="log-date">${tgl.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        </td>
        <td>
          ${(s.includes("TIDAK MASUK") || s.includes("ALPHA")) ? `
            <div style="display:flex; align-items:center; gap:6px; color:var(--danger); font-size:0.75rem; font-weight:800;">
              <i data-lucide="user-x" style="width:14px; height:14px; flex-shrink:0;"></i> ${escapeHtml(lateInfo.ringkasan)}
            </div>
            <div style="font-size:0.72rem; color:#dc2626; font-weight:600; margin-top:3px; line-height:1.3;">
              ${escapeHtml(lateInfo.detail)}
            </div>
          ` : (s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI")) ? `
            <div style="display:flex; align-items:center; gap:6px; color:#d97706; font-size:0.75rem; font-weight:800;">
              <i data-lucide="file-text" style="width:14px; height:14px; flex-shrink:0;"></i> ${escapeHtml(lateInfo.ringkasan)}
            </div>
            <div style="font-size:0.72rem; color:#b45309; font-weight:600; margin-top:3px; line-height:1.3;">
              ${escapeHtml(lateInfo.detail)}
            </div>
          ` : lateInfo.isLate ? `
            <div style="display:flex; align-items:center; gap:6px; color:var(--danger); font-size:0.75rem; font-weight:800;">
              <i data-lucide="alert-circle" style="width:14px; height:14px; flex-shrink:0;"></i> ${escapeHtml(lateInfo.ringkasan)}
            </div>
            <div style="font-size:0.72rem; color:#dc2626; font-weight:600; margin-top:3px; line-height:1.3;">
              ${escapeHtml(lateInfo.detail)}
            </div>
          ` : (isMasuk ? `
            <div style="display:flex; align-items:center; gap:6px; color:var(--success); font-size:0.75rem; font-weight:700;">
              <i data-lucide="check-circle" style="width:14px; height:14px; flex-shrink:0;"></i> TEPAT WAKTU
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">
              ${escapeHtml(lateInfo.detail)}
            </div>
          ` : `
            <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:0.75rem; font-weight:600;">
              <i data-lucide="check" style="width:12px; height:12px;"></i> Selesai Shift
            </div>
            ${l.keterangan ? `<div style="font-size:0.7rem; color:var(--text-muted); font-style:italic; margin-top:2px;">"${escapeHtml(l.keterangan)}"</div>` : ''}
          `)}
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-small" style="padding: 6px 10px;" onclick="bukaModalEdit(${l.id})">
              <i data-lucide="edit-3" style="width:14px;"></i>
            </button>
            <button class="btn btn-danger btn-small" style="padding: 6px 10px;" onclick="hapusSatuLog(${l.id})">
              <i data-lucide="trash-2" style="width:14px;"></i>
            </button>
          </div>
        </td>
      </tr>`;
  });

  if (!htmlRows) {
    if (statusFilter === "TIDAK_MASUK") {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:3rem; color:#16a34a; font-weight:700;"><i data-lucide="check-circle" style="width:20px; height:20px; vertical-align:middle; margin-right:6px;"></i> Seluruh karyawan telah hadir / tidak ada yang berstatus Alpha.</td></tr>';
    } else {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:3rem; color:var(--text-muted);">Tidak ada log absensi dalam periode ini.</td></tr>';
    }
  } else {
    body.innerHTML = htmlRows;
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function filterLogByCard(status) {
  const sel = document.getElementById("logFilterStatus");
  if (sel) {
    sel.value = status;
  }
  renderLogTable();
}

function bukaInputManualKaryawan(nama, tglStr) {
  showManualLogModal();
  if (nama) {
    const sel = document.getElementById("manLogNama");
    if (sel) sel.value = nama;
  }
  if (tglStr) {
    const tglEl = document.getElementById("manLogTgl");
    if (tglEl) tglEl.value = tglStr;
  }
  const statusEl = document.getElementById("manLogStatus");
  if (statusEl) statusEl.value = "TIDAK MASUK (ALPHA)";
}

function renderKaryawanTable() {
  const body = document.getElementById("karyawanTableBody");
  if (!body) return;

  let htmlRows = "";
  const filteredK = getFilteredKaryawan();
  filteredK.forEach((k) => {
    const d = hitungDetailGaji(k.gaji || 0, k.nama);
    const kpi = calculateLiveKPI(d.hadir, d.telat);
    const compName = getCompanyOfKaryawan(k);

    htmlRows += `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 15px;">
            <div style="width: 48px; height: 48px; border-radius: 14px; overflow: hidden; border: 2.5px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,0.1); background: #f1f5f9; flex-shrink: 0;">
              <img src="${getEmployeeAvatar(k)}" 
                   onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(k.nama)}&background=4f46e5&color=fff&bold=true'"
                   style="width: 100%; height: 100%; object-fit: cover;">
            </div>
            <div>
              <div style="font-weight: 800; color: var(--sidebar-bg); font-size: 0.95rem;">${k.nama}</div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600;">ID: ${k.nik}</span>
                <span class="badge" style="font-size: 0.65rem; padding: 2px 6px; background: #e0e7ff; color: #4338ca; font-weight: 700;">${compName}</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          <div style="display: flex; flex-direction: column;">
            <span style="font-weight: 700; color: var(--text-main); font-size: 0.85rem;">${k.jabatan || k.dept}</span>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
              <div style="width: 6px; height: 6px; border-radius: 50%; background: ${d.hadir >= d.totalHariKerja ? 'var(--success)' : 'var(--warning)'}"></div>
              <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">Hadir: <strong>${d.hadir}</strong> / ${d.totalHariKerja}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 700; color: var(--sidebar-bg);">${d.totalLembur} <small>Hrs</small></div>
          <div style="font-size: 0.7rem; color: var(--success); font-weight: 700;">+Rp ${Math.floor(d.uangLembur).toLocaleString("id-ID")}</div>
          <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 500;" title="${escapeHtml(d.keteranganTarifLembur)}">@Rp ${d.tarifLembur.toLocaleString("id-ID")}/jam</div>
        </td>
        <td>
          <div style="font-weight: 800; color: var(--sidebar-bg);">Rp ${Math.floor(d.gapok).toLocaleString("id-ID")}</div>
          <div style="font-size: 0.65rem; color: var(--text-muted);">${d.keteranganGapok ? `<span style="color:#4f46e5; font-weight:700;">${escapeHtml(d.keteranganGapok)}</span><br>` : ''}${k.rekening || "No Acc"}</div>
        </td>
        <td style="color: var(--success); font-weight: 900; font-size: 1rem; letter-spacing: -0.5px;">
          Rp ${Math.floor(d.thp).toLocaleString("id-ID")}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="text-align: right;">
              <div style="font-weight: 900; font-size: 1.1rem; color: ${kpi.color}; line-height: 1;">${kpi.score.toFixed(1)}</div>
              <div style="font-size: 0.65rem; font-weight: 800; color: #94a3b8;">GRADE ${kpi.grade}</div>
            </div>
            <div style="width: 4px; height: 24px; background: ${kpi.color}; border-radius: 2px;"></div>
          </div>
        </td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: nowrap;">
            <button class="btn btn-outline btn-small" style="padding: 6px;" onclick="cetakSlip('${k.id}')" title="Cetak Slip">
                <i data-lucide="printer" style="width:14px;"></i>
            </button>
            <button class="btn btn-primary btn-small" style="background:#25d366; border:none; padding: 6px;" onclick="kirimSlipOtomatisById('${k.id}')" title="Kirim Otomatis via WhatsApp">
                <i data-lucide="message-circle" style="width:14px;"></i>
            </button>
            <button class="btn btn-outline btn-small" style="padding: 6px;" onclick="bukaModalEditKaryawan('${k.id}')" title="Edit Data">
                <i data-lucide="edit-3" style="width:14px;"></i>
            </button>
            <button class="btn btn-danger btn-small" style="padding: 6px;" onclick="hapusKaryawan('${k.id}')" title="Hapus">
                <i data-lucide="trash-2" style="width:14px;"></i>
            </button>
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function kirimSlipOtomatisById(id) {
  const k = KARYAWAN.find(x => String(x.id) === String(id));
  if (k) return kirimSlipOtomatis(k);
}

// --- PAYROLL & OVERTIME LOGIC ---
// --- UTILS: TIMEZONE-SAFE ---
function toLocalISO(date) {
  const pad = num => (num < 10 ? '0' : '') + num;
  return date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes()) +
    ':' + pad(date.getSeconds());
}

function getWIBThreshold(dateObj, targetHour) {
  // Paksa pengambilan tanggal di zona waktu Asia/Jakarta (WIB)
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(dateObj);
  const d = parts.find(p => p.type === 'day').value;
  const m = parts.find(p => p.type === 'month').value;
  const y = parts.find(p => p.type === 'year').value;

  // Buat objek Date absolut di zona WIB (+07:00)
  return new Date(`${y}-${m}-${d}T${String(targetHour).padStart(2, '0')}:00:00+07:00`);
}

function hitungHariKerjaEfektif(startStr, endStr) {
  if (!startStr || !endStr) return 22; // Fallback
  let start = new Date(startStr + "T00:00:00");
  let end = new Date(endStr + "T23:59:59");
  let count = 0;
  let cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() !== 0) count++; // 0 = Minggu, skip Minggu
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Menghitung tarif lembur per jam spesifik untuk setiap karyawan:
 * 1. Admin: Rp 10.000 / jam (maksimal 1 jam per hari) sesuai instruksi khusus manajemen.
 * 2. Non-Admin (Driver, Helper, Operasional, Staff, Gudang, Sales):
 *    Dihitung proporsional SESUAI GAJI POKOK mengikuti standar regulasi Ketenagakerjaan (PP 35/2021):
 *    Tarif Lembur per Jam = Upah Pokok / 173 jam kerja per bulan.
 * 3. Kustom: Jika profil karyawan memiliki tarif_lembur kustom, gunakan nilai tersebut.
 * Minimal tarif lembur adalah Rp 10.000 / jam.
 */
function getTarifLemburKaryawan(k) {
  if (!k) return 10000;

  // 1. Cek jika ada custom tarif_lembur yang diset di profil karyawan
  if (k.tarif_lembur && parseFloat(k.tarif_lembur) > 0) {
    return Math.round(parseFloat(k.tarif_lembur));
  }

  // 2. Deteksi Jabatan Admin
  const isAdminRole = (
    (k.jabatan || '').toUpperCase().includes('ADMIN') ||
    (k.dept || '').toUpperCase().includes('ADMIN')
  );

  if (isAdminRole) {
    return 10000; // Kebijakan khusus Admin: Rp 10.000/jam (dibatasi 1 jam/hari)
  }

  // 3. Untuk Non-Admin (Operasional, Driver, Helper, Gudang, Sales, dll.)
  // Dihitung SESUAI GAJI POKOK (Rumus Resmi Depnaker: Upah / 173)
  const gapok = parseFloat(k.gaji) || 0;
  if (gapok > 0) {
    const tarifDepnaker = Math.round(gapok / 173);
    return Math.max(tarifDepnaker, 10000);
  }

  // Jika gaji belum terisi (0), fallback ke standar operasional awal (Rp 20.000/jam)
  return 20000;
}

function getKeteranganTarifLembur(k, tarif) {
  if (!k) return `Tarif Standar: Rp ${(tarif || 10000).toLocaleString('id-ID')}/jam`;

  if (k.tarif_lembur && parseFloat(k.tarif_lembur) > 0) {
    return `Tarif Kustom Profil: Rp ${tarif.toLocaleString('id-ID')}/jam`;
  }

  const isAdminRole = (
    (k.jabatan || '').toUpperCase().includes('ADMIN') ||
    (k.dept || '').toUpperCase().includes('ADMIN')
  );

  if (isAdminRole) {
    return `Khusus Admin: Rp 10.000/jam (Maks 1 Jam/Hari)`;
  }

  const gapok = parseFloat(k.gaji) || 0;
  if (gapok > 0) {
    return `Sesuai Gaji Pokok (1/173 × Rp ${gapok.toLocaleString('id-ID')} = Rp ${tarif.toLocaleString('id-ID')}/jam)`;
  }

  return `Tarif Standar Operasional: Rp 20.000/jam`;
}

/**
 * Menghitung detail keterlambatan log absensi:
 * Menghitung selisih menit dari jam masuk standar (09:00 WIB),
 * menyertakan catatan/note karyawan dan toleransi (09:15 WIB).
 */
function hitungDetailKeterlambatan(log) {
  if (!log) return { isLate: false, menitTelat: 0, durasiStr: "-", ringkasan: "-", detail: "-" };

  const isLate = log.isLate === true || log.isLate === "true" || log.is_late === true;
  const statusUpper = (log.status || "").toUpperCase();

  if (statusUpper.includes("TIDAK MASUK") || statusUpper.includes("ALPHA")) {
    return {
      isLate: false,
      menitTelat: 0,
      durasiStr: "-",
      ringkasan: "TIDAK MASUK (ALPHA)",
      detail: log.keterangan ? `Tidak Hadir / Alpha: ${log.keterangan}` : "Tidak hadir / belum ada rekaman absensi masuk"
    };
  }

  if (statusUpper.includes("IZIN") || statusUpper.includes("SAKIT") || statusUpper.includes("CUTI")) {
    return {
      isLate: false,
      menitTelat: 0,
      durasiStr: "-",
      ringkasan: statusUpper,
      detail: log.keterangan ? `${statusUpper}: ${log.keterangan}` : `Status ${statusUpper}`
    };
  }

  const isMasukType = statusUpper.startsWith("MASUK") || statusUpper.startsWith("DINAS LUAR") || statusUpper.startsWith("BERANGKAT");

  if (!isMasukType) {
    return {
      isLate: false,
      menitTelat: 0,
      durasiStr: "-",
      ringkasan: "-",
      detail: log.keterangan || "-"
    };
  }

  const waktuAbsen = new Date(log.waktu);
  // Jam masuk standar adalah 09:00 WIB
  const thresholdMasuk = getWIBThreshold(waktuAbsen, STANDAR_MASUK);
  const diffMs = waktuAbsen.getTime() - thresholdMasuk.getTime();
  const menitTelat = Math.max(1, Math.round(diffMs / 60000));
  const jamMenitStr = waktuAbsen.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  if (isLate) {
    let durasiStr = "";
    if (menitTelat < 60) {
      durasiStr = `${menitTelat} menit`;
    } else {
      const jam = Math.floor(menitTelat / 60);
      const sisaM = menitTelat % 60;
      durasiStr = sisaM > 0 ? `${jam} jam ${sisaM} menit` : `${jam} jam`;
    }

    let detailStr = `Terlambat ${durasiStr} (Masuk ${jamMenitStr} WIB, Batas: 09:00 WIB, Toleransi: 09:15 WIB)`;
    if (log.keterangan && log.keterangan.trim()) {
      detailStr += ` | Note: ${log.keterangan.trim()}`;
    }

    return {
      isLate: true,
      menitTelat,
      durasiStr,
      ringkasan: `TERLAMBAT (+${durasiStr})`,
      detail: detailStr
    };
  } else {
    let detailStr = `Tepat Waktu (Masuk ${jamMenitStr} WIB)`;
    if (log.keterangan && log.keterangan.trim()) {
      detailStr += ` | Note: ${log.keterangan.trim()}`;
    }
    return {
      isLate: false,
      menitTelat: 0,
      durasiStr: "0 menit",
      ringkasan: "TEPAT WAKTU",
      detail: detailStr
    };
  }
}

// Fungsi penentu skema gaji mingguan vs bulanan
function isGajiMingguan(k) {
  if (!k) return false;
  const dept = (k.dept || "").toUpperCase();
  const jabatan = (k.jabatan || "").toUpperCase();
  const gaji = parseFloat(k.gaji) || 0;

  // 1. Departemen Operasional (Driver, Helper, Lapangan, Gudang Operasional)
  if (dept.includes("OPERASIONAL") || jabatan.includes("DRIVER") || jabatan.includes("HELPER")) {
    return true;
  }

  // 2. Karyawan dengan nominal gaji mingguan (di bawah Rp 2.000.000) dan bukan Direktur/Head
  if (gaji > 0 && gaji < 2000000 && !jabatan.includes("DIREKTUR")) {
    return true;
  }

  return false;
}

function hitungDetailGaji(gapok, namaKaryawan, customStart = null, customEnd = null, customLogs = null) {
  const targetNama = namaKaryawan.trim().toLowerCase();
  const k = KARYAWAN.find(item => item.nama.trim().toLowerCase() === targetNama);

  const tglMulai = customStart || document.getElementById("filterTglMulai")?.value;
  const tglSelesai = customEnd || document.getElementById("filterTglSelesai")?.value;
  const totalHariKerja = hitungHariKerjaEfektif(tglMulai, tglSelesai);

  const g = parseFloat(gapok) || 0;
  const hkeRate = k ? (parseFloat(k.hke_rate) || 50000) : 50000;

  // OPSI A: Skalasi Gaji Pokok untuk Karyawan Bergaji Mingguan (Operasional)
  // Bila difilter lebih dari 10 hari (misal 2 minggu, 3 minggu, atau 1 bulan penuh),
  // Gaji Pokok mingguan otomatis dikalikan dengan jumlah minggu efektif dalam periode tersebut.
  const weeklyScheme = isGajiMingguan(k);
  let jumlahMinggu = 1;
  if (weeklyScheme && tglMulai && tglSelesai) {
    const startD = new Date(tglMulai + "T00:00:00");
    const endD = new Date(tglSelesai + "T23:59:59");
    const diffDays = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    if (diffDays >= 11) {
      jumlahMinggu = Math.max(1, Math.round(diffDays / 7));
    } else {
      jumlahMinggu = 1;
    }
  }

  const gapokEfektif = weeklyScheme ? (g * jumlahMinggu) : g;

  // Otoritas CEO Per Karyawan (Gunakan Nominal yang disetujui CEO)
  const isApproved = k ? (k.is_incentive_approved === true) : false;
  const incentive = isApproved ? (parseFloat(k.incentive_approved_val) || 0) : 0;
  const incentiveLuar = 0; // Dipusatkan ke satu nilai approved_val oleh CEO
  const pinjaman = k ? (parseFloat(k.pinjaman) || 0) : 0;
  const pph21 = k ? (parseFloat(k.pph21) || 0) : 0;

  const sourceLogs = (customLogs && Array.isArray(customLogs)) ? customLogs : allLogs;
  let dataLogKaryawan = sourceLogs
    .filter((l) => (l.nama || '').trim().toLowerCase() === targetNama)
    .sort((a, b) => new Date(a.waktu) - new Date(b.waktu));

  // --- FILTER TANGGAL ---
  if (tglMulai && tglSelesai) {
    const start = new Date(tglMulai + "T00:00:00");
    const end = new Date(tglSelesai + "T23:59:59");
    dataLogKaryawan = dataLogKaryawan.filter(l => {
      const w = new Date(l.waktu);
      return w >= start && w <= end;
    });
  }

  const getShiftDateStr = (dateObj) => {
    // Buffer 4 jam: Absen dini hari dianggap hari sebelumnya
    const d = new Date(dateObj.getTime() - 4 * 3600000);
    return d.toISOString().split('T')[0];
  };
  const hariHadir = [...new Set(
    dataLogKaryawan
      .filter(l => {
        const s = l.status.toUpperCase();
        return s.startsWith('MASUK') || s.startsWith('BERANGKAT') || s.startsWith('DINAS LUAR');
      })
      .map(l => {
        const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
        return d.getDay() !== 0 ? toLocalISO(d).split('T')[0] : null;
      })
      .filter(d => d !== null)
  )].length;

  // Deteksi peran Jabatan Admin untuk aturan batasan lembur
  const isAdminRole = k && (
    (k.jabatan || '').toUpperCase().includes('ADMIN') ||
    (k.dept || '').toUpperCase().includes('ADMIN')
  );

  let totalLembur = 0;
  let totalJamKerja = 0; // Tambahan kalkulasi Total Jam Kerja Riil
  let i = 0;
  while (i < dataLogKaryawan.length) {
    const l = dataLogKaryawan[i];
    const statusUpper = l.status.toUpperCase();
    if (statusUpper.startsWith('MASUK') || statusUpper.startsWith('BERANGKAT') || statusUpper.startsWith('DINAS LUAR')) {
      const actualMasuk = new Date(l.waktu);
      const thresholdMasuk = getWIBThreshold(actualMasuk, STANDAR_MASUK);
      let lemburHariIni = 0; // Akumulasi lembur khusus untuk shift/hari ini

      if (actualMasuk < thresholdMasuk) {
        let jamPagi = (thresholdMasuk - actualMasuk) / (1000 * 60 * 60);
        if (jamPagi > 0) lemburHariIni += jamPagi;
      }
      let shiftEnd = null;
      let j = i + 1;
      while (j < dataLogKaryawan.length && dataLogKaryawan[j].status.toUpperCase().startsWith('PULANG')) {
        shiftEnd = new Date(dataLogKaryawan[j].waktu);
        j++;
      }
      // Penentuan Standar Pulang Dinamis Berdasarkan Departemen
      const isOffice = k && (
        (k.dept && (k.dept.toUpperCase().includes("OFFICE") || k.dept.toUpperCase().includes("FINANCE"))) ||
        isAdminRole
      );
      const currentStdPulang = isOffice ? 18 : 17; // Office/Finance/Admin 9 jam (18:00), Operasional 8 jam (17:00)

      if (shiftEnd) {
        // Kalkulasi Total Jam Kerja (Dari Masuk hingga Pulang)
        let durasiShift = (shiftEnd - actualMasuk) / (1000 * 60 * 60);
        if (durasiShift > 0) totalJamKerja += durasiShift;

        // Kalkulasi Lembur Sore
        const thresholdPulang = getWIBThreshold(actualMasuk, currentStdPulang);
        let jamSore = (shiftEnd - thresholdPulang) / (1000 * 60 * 60);
        if (jamSore > 0) lemburHariIni += jamSore;
        
        i = j;
      } else { i++; }

      // ATURAN KHUSUS JABATAN ADMIN: DIBATASI MAKSIMAL 1 JAM LEMBUR PER HARI
      if (isAdminRole && lemburHariIni > 1) {
        lemburHariIni = 1;
      }

      totalLembur += lemburHariIni;
    } else { i++; }
  }

  // --- LOGIKA LEMBUR SESUAI GAJI & JABATAN (Pembulatan 0.1 Jam) ---
  let uangLembur = 0;
  const adjJam = k ? (parseFloat(k.lembur_adj) || 0) : 0;
  let jamLemburFinal = totalLembur + adjJam; // Terapkan penyesuaian manual
  let jamLemburBulat = jamLemburFinal;

  // CEK APAKAH LEMBUR AKTIF UNTUK KARYAWAN INI
  // Jabatan Admin sekarang mendapatkan lemburan (otomatis aktif & dibatasi 1 jam per hari)
  const isLemburAktif = isAdminRole ? true : (k ? (k.is_lembur !== false) : true);

  // Hitung tarif lembur per jam spesifik untuk karyawan ini:
  // Admin: Rp 10.000 / jam (max 1 jam/hari)
  // Non-Admin: Sesuai gaji pokok (1/173 x Gaji) atau tarif_lembur kustom
  const tarifLembur = getTarifLemburKaryawan(k);
  const keteranganTarifLembur = getKeteranganTarifLembur(k, tarifLembur);

  if (isLemburAktif) {
    jamLemburBulat = Math.round(jamLemburFinal * 10) / 10;
    uangLembur = Math.round(jamLemburBulat * tarifLembur);
  } else {
    uangLembur = 0;
    jamLemburBulat = 0;
  }

  // --- TOTAL SALARY ---
  // Pakai startsWith MASUK/DINAS LUAR (bukan === 'MASUK' saja): status "DINAS
  // LUAR" yang telat juga harus terhitung, sama seperti hariHadir di atas
  // sudah menghitungnya benar - sebelumnya karyawan Dinas Luar yang telat
  // tidak pernah tercatat telat di sini.
  const telatCount = dataLogKaryawan.filter(l => {
    const s = (l.status || '').toUpperCase();
    return (s.startsWith('MASUK') || s.startsWith('DINAS LUAR')) && l.isLate;
  }).length;

  // --- TOTAL SALARY ---
  const uangHKE = hariHadir * hkeRate;
  const thp = gapokEfektif + uangHKE + incentive + incentiveLuar + uangLembur - pinjaman - pph21;

  let keteranganGapok = "";
  if (weeklyScheme && jumlahMinggu > 1) {
    keteranganGapok = `${jumlahMinggu} minggu (@Rp ${Math.floor(g).toLocaleString("id-ID")})`;
  }

  return {
    gapok: gapokEfektif,
    gapokAsli: g,
    jumlahMinggu,
    keteranganGapok,
    isWeeklyScheme: weeklyScheme,
    hkeRate,
    uangHKE,
    hadir: hariHadir,
    telat: telatCount,
    totalHariKerja,
    totalJamKerja: Math.round(totalJamKerja * 10) / 10, // Dibulatkan 1 desimal
    totalLembur: jamLemburBulat.toFixed(1),
    tarifLembur,
    keteranganTarifLembur,
    uangLembur,
    incentive,
    incentiveLuar,
    pinjaman,
    pph21,
    thp: thp > 0 ? thp : 0
  };
}

function calculateLiveKPI(hadir, telat) {
  const totalHariKerja = 22;
  const attendanceScore = (hadir / totalHariKerja) * 100;
  const punctualityScore = hadir > 0 ? ((hadir - telat) / hadir) * 100 : 0;
  const finalScore = (attendanceScore * 0.6) + (punctualityScore * 0.4);

  let grade = "C";
  let color = "#ef4444";
  if (finalScore >= 85) { grade = "A"; color = "#10b981"; }
  else if (finalScore >= 70) { grade = "B"; color = "#f59e0b"; }

  return { score: finalScore > 100 ? 100 : finalScore, grade, color };
}

function cetakSlip(idOrIndex) {
  let k;
  if (typeof idOrIndex === "object" && idOrIndex !== null) {
    k = idOrIndex;
  } else if (typeof idOrIndex === "string" || typeof idOrIndex === "number") {
    k = KARYAWAN.find(x => String(x.id) === String(idOrIndex)) || KARYAWAN[idOrIndex];
  }
  if (!k) return;

  const d = hitungDetailGaji(k.gaji, k.nama);
  const tglMulai = document.getElementById("filterTglMulai")?.value;
  const tglSelesai = document.getElementById("filterTglSelesai")?.value;

  const fmt = (d) => d ? d.split('-').reverse().join('/') : '-';
  const periodeTampil = (tglMulai && tglSelesai) ? `${fmt(tglMulai)} - ${fmt(tglSelesai)}` : "Bulan Berjalan";
  const branding = getCompanyBranding(k);

  const html = `
    <html>
    <head>
      <title>Slip Gaji - ${k.nama}</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
      <style>
        :root { --primary: #4f46e5; --slate-800: #1e293b; --slate-500: #64748b; --slate-200: #e2e8f0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Outfit', sans-serif; color: var(--slate-800); background: #f1f5f9; padding: 30px; }
        
        .payslip-card { background: white; max-width: 800px; margin: 0 auto; padding: 40px; border-radius: 16px; border: 1px solid var(--slate-200); position: relative; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
        .confidential { position: absolute; top: 20px; right: -35px; background: #fee2e2; color: #ef4444; padding: 5px 40px; transform: rotate(45deg); font-size: 0.6rem; font-weight: 800; letter-spacing: 1px; }

        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid var(--slate-800); padding-bottom: 20px; }
        .logo-section { display: flex; align-items: center; gap: 15px; }
        .logo-section img { width: 60px; height: 60px; object-fit: contain; }
        .company-name h1 { font-size: 1.25rem; font-weight: 800; color: var(--primary); margin: 0; }
        .company-name p { font-size: 0.7rem; color: var(--slate-500); max-width: 250px; }
        .doc-title { text-align: right; }
        .doc-title h2 { font-size: 1.8rem; font-weight: 800; text-transform: uppercase; margin: 0; }
        .doc-title p { font-size: 0.8rem; font-weight: 600; color: var(--slate-500); }

        /* INFO BOX */
        .info-box { display: flex; gap: 20px; background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 30px; border: 1px solid var(--slate-200); }
        .info-photo { width: 85px; height: 85px; border-radius: 8px; border: 2px solid white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden; }
        .info-photo img { width: 100%; height: 100%; object-fit: cover; }
        .info-details { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 30px; }
        .info-item { display: flex; flex-direction: column; }
        .info-item .label { font-size: 0.6rem; text-transform: uppercase; color: var(--slate-500); font-weight: 700; }
        .info-item .val { font-size: 0.85rem; font-weight: 600; }

        /* SALARY GRID */
        .salary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
        .salary-col h3 { font-size: 0.85rem; font-weight: 800; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid var(--slate-200); margin-bottom: 12px; color: var(--primary); }
        .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc; }
        .row .label { color: var(--slate-500); }
        .row .val { font-weight: 600; }

        /* TOTAL SECTION */
        .total-section { background: var(--slate-800); color: white; padding: 20px 30px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .total-thp { display: flex; flex-direction: column; }
        .total-thp .label { font-size: 0.75rem; font-weight: 600; opacity: 0.7; }
        .total-thp .val { font-size: 1.75rem; font-weight: 800; }
        .thp-message { text-align: right; font-size: 0.75rem; font-style: italic; opacity: 0.8; max-width: 250px; }

        /* SIGNATURES */
        .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
        .sign-box { text-align: center; width: 180px; }
        .sign-box .label { font-size: 0.7rem; font-weight: 700; color: var(--slate-500); margin-bottom: 60px; text-transform: uppercase; }
        .sign-box .name { font-size: 0.85rem; font-weight: 800; border-bottom: 1.5px solid var(--slate-800); padding-bottom: 3px; }

        @media print {
            body { background: white; padding: 0; }
            .payslip-card { border: none; box-shadow: none; padding: 20px; }
        }
      </style>
    </head>
    <body>
      <div class="payslip-card">
        <div class="confidential">CONFIDENTIAL</div>
        
        <header class="header">
          <div class="logo-section">
            <img src="${branding.logo}" alt="Logo">
            <div class="company-name">
              <h1>${branding.name}</h1>
              <p>${branding.address}</p>
            </div>
          </div>
          <div class="doc-title">
            <h2>PAYSLIP</h2>
            <p>${periodeTampil}</p>
          </div>
        </header>

        <section class="info-box">
          <div class="info-photo">
            <img src="${getEmployeeAvatar(k)}" 
                 onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(k.nama)}&background=4f46e5&color=fff'">
          </div>
          <div class="info-details">
            <div class="info-item"><span class="label">Nama Karyawan</span><span class="val">${k.nama}</span></div>
            <div class="info-item"><span class="label">NIK / ID</span><span class="val">${k.nik}</span></div>
            <div class="info-item"><span class="label">Perusahaan</span><span class="val" style="color:var(--primary); font-weight:700;">${getCompanyOfKaryawan(k)}</span></div>
            <div class="info-item"><span class="label">Jabatan / Dept</span><span class="val">${k.jabatan || k.dept}</span></div>
            <div class="info-item"><span class="label">No. Rekening</span><span class="val">${k.rekening || '-'}</span></div>
            <div class="info-item"><span class="label">Hadir / Hari Kerja</span><span class="val">${d.hadir} / ${d.totalHariKerja} Hari</span></div>
            <div class="info-item"><span class="label">NPWP</span><span class="val">${k.npwp || '-'}</span></div>
          </div>
        </section>

        <section class="salary-grid">
          <div class="salary-col">
            <h3>Penerimaan (Earnings)</h3>
            <div class="row"><span class="label">GAJI POKOK ${d.keteranganGapok ? `(${escapeHtml(d.keteranganGapok)})` : ''}</span><span class="val">Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">HKE (${d.hadir} hari)</span><span class="val">Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">INCENTIVE</span><span class="val">Rp ${Math.floor(d.incentive || 0).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">INCENTIVE (LK/NGINAP)</span><span class="val">Rp ${Math.floor(d.incentiveLuar || 0).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">OVERTIME (${d.totalLembur} jam @ Rp ${d.tarifLembur.toLocaleString('id-ID')})</span><span class="val">Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}</span></div>
          </div>
          <div class="salary-col">
            <h3>Potongan (Deductions)</h3>
            <div class="row"><span class="label">PINJAMAN KANTOR</span><span class="val">Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">PPh21</span><span class="val">Rp ${Math.floor(d.pph21).toLocaleString('id-ID')}</span></div>
            <div class="row" style="margin-top: 15px; border-top: 1px solid var(--slate-200); padding-top: 10px;">
                <span class="label" style="font-weight: 800;">TOTAL POTONGAN</span>
                <span class="val">Rp ${Math.floor(d.pinjaman + d.pph21).toLocaleString('id-ID')}</span>
            </div>
          </div>
        </section>

        <section class="total-section">
          <div class="total-thp">
            <span class="label">Total THP</span>
            <span class="val">Rp ${Math.floor(d.thp).toLocaleString('id-ID')}</span>
          </div>
          <div class="thp-message">
            "Semoga bermanfaat untuk keluarga. Terus berkarya bersama ${branding.name}."
          </div>
        </section>

        <footer class="signatures">
          <div class="sign-box">
            <p class="label">Diterima Oleh,</p>
            <p class="name">${k.nama}</p>
          </div>
          <div class="sign-box">
            <p class="label">HRD / Management,</p>
            <p class="name">${branding.name}</p>
          </div>
        </footer>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

function getPeriodeTampilAktif() {
  const tglMulai = document.getElementById("filterTglMulai")?.value;
  const tglSelesai = document.getElementById("filterTglSelesai")?.value;
  const fmt = (dt) => dt ? dt.split('-').reverse().join('/') : '-';
  return (tglMulai && tglSelesai) ? `${fmt(tglMulai)} - ${fmt(tglSelesai)}` : "Bulan Berjalan";
}

async function generateSlipGajiBlob(k, d, periodeTampil) {
  const branding = getCompanyBranding(k);
  const renderContainer = document.createElement("div");
  renderContainer.style.position = "absolute";
  renderContainer.style.top = "-9999px";
  renderContainer.style.width = "800px";
  renderContainer.style.backgroundColor = "white";
  document.body.appendChild(renderContainer);

  const slipHtml = `
      <style>
        #slip-to-share { font-family: 'Outfit', sans-serif; }
        #slip-to-share * { box-sizing: border-box; margin: 0; padding: 0; }
        #slip-to-share.payslip-card { background: white; padding: 40px; border-radius: 16px; border: 1px solid #e2e8f0; position: relative; overflow: hidden; color: #1e293b; }
        #slip-to-share .confidential { position: absolute; top: 20px; right: -35px; background: #fee2e2; color: #ef4444; padding: 5px 40px; transform: rotate(45deg); font-size: 0.6rem; font-weight: 800; letter-spacing: 1px; }
        #slip-to-share .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #1e293b; padding-bottom: 20px; }
        #slip-to-share .logo-section { display: flex; align-items: center; gap: 15px; }
        #slip-to-share .logo-section img { width: 60px; height: 60px; object-fit: contain; }
        #slip-to-share .company-name h1 { font-size: 1.25rem; font-weight: 800; color: #4f46e5; margin: 0; }
        #slip-to-share .company-name p { font-size: 0.7rem; color: #64748b; max-width: 250px; }
        #slip-to-share .doc-title { text-align: right; }
        #slip-to-share .doc-title h2 { font-size: 1.8rem; font-weight: 800; text-transform: uppercase; margin: 0; }
        #slip-to-share .doc-title p { font-size: 0.8rem; font-weight: 600; color: #64748b; }
        #slip-to-share .info-box { display: flex; gap: 20px; background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 30px; border: 1px solid #e2e8f0; }
        #slip-to-share .info-photo { width: 85px; height: 85px; border-radius: 8px; border: 2px solid white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden; flex-shrink: 0; }
        #slip-to-share .info-photo img { width: 100%; height: 100%; object-fit: cover; }
        #slip-to-share .info-details { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 30px; }
        #slip-to-share .info-item { display: flex; flex-direction: column; }
        #slip-to-share .info-item .label { font-size: 0.6rem; text-transform: uppercase; color: #64748b; font-weight: 700; }
        #slip-to-share .info-item .val { font-size: 0.85rem; font-weight: 600; }
        #slip-to-share .salary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
        #slip-to-share .salary-col h3 { font-size: 0.85rem; font-weight: 800; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; margin-bottom: 12px; color: #4f46e5; }
        #slip-to-share .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc; }
        #slip-to-share .row .label { color: #64748b; }
        #slip-to-share .row .val { font-weight: 600; }
        #slip-to-share .total-section { background: #1e293b; color: white; padding: 20px 30px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        #slip-to-share .total-thp { display: flex; flex-direction: column; }
        #slip-to-share .total-thp .label { font-size: 0.75rem; font-weight: 600; opacity: 0.7; }
        #slip-to-share .total-thp .val { font-size: 1.75rem; font-weight: 800; }
        #slip-to-share .thp-message { text-align: right; font-size: 0.75rem; font-style: italic; opacity: 0.8; max-width: 250px; }
        #slip-to-share .signatures { display: flex; justify-content: space-between; margin-top: 40px; }
        #slip-to-share .sign-box { text-align: center; width: 180px; }
        #slip-to-share .sign-box .label { font-size: 0.7rem; font-weight: 700; color: #64748b; margin-bottom: 60px; text-transform: uppercase; }
        #slip-to-share .sign-box .name { font-size: 0.85rem; font-weight: 800; border-bottom: 1.5px solid #1e293b; padding-bottom: 3px; }
      </style>
      <div id="slip-to-share" class="payslip-card">
        <div class="confidential">CONFIDENTIAL</div>

        <header class="header">
          <div class="logo-section">
            <img src="${branding.logo}" alt="Logo">
            <div class="company-name">
              <h1>${branding.name}</h1>
              <p>${branding.address}</p>
            </div>
          </div>
          <div class="doc-title">
            <h2>PAYSLIP</h2>
            <p>${periodeTampil}</p>
          </div>
        </header>

        <section class="info-box">
          <div class="info-photo">
            <img src="${getEmployeeAvatar(k)}"
                 onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(k.nama)}&background=4f46e5&color=fff'">
          </div>
          <div class="info-details">
            <div class="info-item"><span class="label">Nama Karyawan</span><span class="val">${k.nama}</span></div>
            <div class="info-item"><span class="label">NIK / ID</span><span class="val">${k.nik}</span></div>
            <div class="info-item"><span class="label">Perusahaan</span><span class="val" style="color:#4f46e5; font-weight:700;">${getCompanyOfKaryawan(k)}</span></div>
            <div class="info-item"><span class="label">Jabatan / Dept</span><span class="val">${k.jabatan || k.dept}</span></div>
            <div class="info-item"><span class="label">No. Rekening</span><span class="val">${k.rekening || '-'}</span></div>
            <div class="info-item"><span class="label">Hadir / Hari Kerja</span><span class="val">${d.hadir} / ${d.totalHariKerja} Hari</span></div>
            <div class="info-item"><span class="label">NPWP</span><span class="val">${k.npwp || '-'}</span></div>
          </div>
        </section>

        <section class="salary-grid">
          <div class="salary-col">
            <h3>Penerimaan (Earnings)</h3>
            <div class="row"><span class="label">GAJI POKOK ${d.keteranganGapok ? `(${escapeHtml(d.keteranganGapok)})` : ''}</span><span class="val">Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">HKE (${d.hadir} hari)</span><span class="val">Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">INCENTIVE</span><span class="val">Rp ${Math.floor(d.incentive || 0).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">INCENTIVE (LK/NGINAP)</span><span class="val">Rp ${Math.floor(d.incentiveLuar || 0).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">OVERTIME (${d.totalLembur} jam @ Rp ${d.tarifLembur.toLocaleString('id-ID')})</span><span class="val">Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}</span></div>
          </div>
          <div class="salary-col">
            <h3>Potongan (Deductions)</h3>
            <div class="row"><span class="label">PINJAMAN KANTOR</span><span class="val">Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">PPh21</span><span class="val">Rp ${Math.floor(d.pph21).toLocaleString('id-ID')}</span></div>
            <div class="row" style="margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                <span class="label" style="font-weight: 800;">TOTAL POTONGAN</span>
                <span class="val">Rp ${Math.floor(d.pinjaman + d.pph21).toLocaleString('id-ID')}</span>
            </div>
          </div>
        </section>

        <section class="total-section">
          <div class="total-thp">
            <span class="label">Total THP</span>
            <span class="val">Rp ${Math.floor(d.thp).toLocaleString('id-ID')}</span>
          </div>
          <div class="thp-message">
            "Semoga bermanfaat untuk keluarga. Terus berkarya bersama ${branding.name}."
          </div>
        </section>

        <footer class="signatures">
          <div class="sign-box">
            <p class="label">Diterima Oleh,</p>
            <p class="name">${k.nama}</p>
          </div>
          <div class="sign-box">
            <p class="label">HRD / Management,</p>
            <p class="name">${branding.name}</p>
          </div>
        </footer>
      </div>
    `;
  renderContainer.innerHTML = slipHtml;

  await new Promise((r) => setTimeout(r, 200));

  const canvas = await html2canvas(renderContainer.querySelector("#slip-to-share"), {
    scale: 1.2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    removeContainer: true
  });

  document.body.removeChild(renderContainer);

  const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const fileName = `Slip_Gaji_${k.nama.replace(/\s+/g, '_')}_${periodeTampil.replace(/\//g, '-')}.png`;
  return { imageBlob, fileName };
}

async function kirimSlipWA(idOrIndex) {
  let k;
  if (typeof idOrIndex === "object" && idOrIndex !== null) {
    k = idOrIndex;
  } else if (typeof idOrIndex === "string" || typeof idOrIndex === "number") {
    k = KARYAWAN.find(x => String(x.id) === String(idOrIndex)) || KARYAWAN[idOrIndex];
  }
  if (!k) return;

  const d = hitungDetailGaji(k.gaji, k.nama);

  if (!k.nomor_wa) return alert("Nomor WhatsApp tidak ditemukan!");

  showLoading(true);

  try {
    const periodeTampil = getPeriodeTampilAktif();
    const { imageBlob, fileName } = await generateSlipGajiBlob(k, d, periodeTampil);
    const imageFile = new File([imageBlob], fileName, { type: 'image/png' });

    // Format WhatsApp Link
    let noWa = k.nomor_wa.trim();
    if (noWa.startsWith("0")) noWa = "62" + noWa.slice(1);
    else if (!noWa.startsWith("62")) noWa = "62" + noWa;

    const pesan = `Halo *${k.nama}*,\n\nBerikut adalah *Slip Gaji Digital* Anda dari *${getCompanyOfKaryawan(k)}* untuk periode *${periodeTampil}*.\n\nTotal THP: *Rp ${Math.floor(d.thp).toLocaleString('id-ID')}*\n\n_(Mohon tempel/paste gambar slip gaji yang sudah tersalin otomatis ke chat ini)_`;
    const waUrl = `https://wa.me/${noWa}?text=${encodeURIComponent(pesan)}`;

    // STEP 1: Try Native Share (Best for Mobile)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
      try {
        await navigator.share({
          files: [imageFile],
          title: 'Slip Gaji Digital',
          text: pesan
        });
        showToast("Slip Gambar dikirim via Share!", "success");
        return; // Success
      } catch (sErr) {
        console.log("Share failed or canceled, falling back...");
      }
    }

    // STEP 2: Copy to Clipboard (Best for Desktop/PC)
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({ "image/png": imageBlob });
        await navigator.clipboard.write([item]);
        showToast("Gambar Tersalin ke Clipboard!", "success");
      }
    } catch (cErr) {
      console.log("Clipboard copy failed, falling back to download...");
    }

    // STEP 3: Fallback Download & Open WA
    const link = document.createElement('a');
    link.href = URL.createObjectURL(imageBlob);
    link.download = fileName;
    link.click();

    window.open(waUrl, '_blank');
    showToast("Gambar terunduh! Silakan tempel/lampirkan di WA.", "info");

  } catch (err) {
    console.error(err);
    alert("Gagal memproses slip gambar: " + err.message);
  } finally {
    showLoading(false);
  }
}

// Kirim slip gaji OTOMATIS (tanpa klik manual di WhatsApp) via Fonnte.
// Alur: render slip -> upload PNG ke storage bucket "slip-gaji" -> panggil
// Edge Function send-salary-report yang menyimpan FONNTE_TOKEN secara aman.
async function kirimSlipOtomatis(k, { silent = false } = {}) {
  if (!k.nomor_wa) {
    if (!silent) showToast("Nomor WhatsApp karyawan ini belum diisi.", "error");
    return { ok: false, error: "Nomor WhatsApp kosong" };
  }

  if (!silent) showLoading(true);
  try {
    const d = hitungDetailGaji(k.gaji, k.nama);
    const periodeTampil = getPeriodeTampilAktif();
    const { imageBlob, fileName } = await generateSlipGajiBlob(k, d, periodeTampil);

    const path = `${k.nik || k.id}/${Date.now()}_${fileName}`;
    const { error: uploadErr } = await supabaseClient.storage
      .from("slip-gaji")
      .upload(path, imageBlob, { contentType: "image/png", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: pub } = supabaseClient.storage.from("slip-gaji").getPublicUrl(path);

    const { data: fnRes, error: fnErr } = await supabaseClient.functions.invoke("send-salary-report", {
      body: {
        nama: k.nama,
        nomor_wa: k.nomor_wa,
        imageUrl: pub.publicUrl,
        periode: periodeTampil,
        totalThp: Math.floor(d.thp),
      },
    });
    if (fnErr) throw fnErr;
    if (fnRes?.error) throw new Error(fnRes.error);

    if (!silent) showToast(`Slip gaji ${k.nama} berhasil dikirim otomatis ke WhatsApp!`, "success");
    logAudit("Kirim Slip Otomatis", `${k.nama} (${k.nik}) - periode ${periodeTampil} (${getCompanyOfKaryawan(k)})`);
    return { ok: true };
  } catch (err) {
    console.error(err);
    if (!silent) showToast("Gagal kirim otomatis: " + err.message, "error");
    return { ok: false, error: err.message };
  } finally {
    if (!silent) showLoading(false);
  }
}

// Kirim slip gaji otomatis ke SEMUA karyawan yang punya nomor WA dalam lingkup perusahaan aktif
async function kirimSemuaSlipOtomatis() {
  const target = getFilteredKaryawan().filter((k) => k.nomor_wa);
  if (target.length === 0) return showToast("Tidak ada karyawan dengan nomor WhatsApp pada lingkup aktif.", "info");

  const entitasLabel = ACTIVE_COMPANY === "ALL" ? "Semua Perusahaan" : ACTIVE_COMPANY;
  if (!confirm(`Kirim slip gaji otomatis ke ${target.length} karyawan (${entitasLabel}) via WhatsApp sekarang?`)) return;

  showLoading(true);
  let sukses = 0;
  const gagalList = [];

  for (let i = 0; i < target.length; i++) {
    const k = target[i];
    showToast(`Mengirim ${i + 1}/${target.length}: ${k.nama}...`, "info");
    const result = await kirimSlipOtomatis(k, { silent: true });
    if (result.ok) sukses++;
    else gagalList.push(`${k.nama} (${result.error})`);

    // Jeda antar pesan agar tidak terdeteksi spam oleh WhatsApp
    if (i < target.length - 1) await new Promise((r) => setTimeout(r, 3000));
  }

  showLoading(false);
  const ringkasan = `Selesai: ${sukses}/${target.length} terkirim${gagalList.length ? `, ${gagalList.length} gagal` : ""}.`;
  showToast(ringkasan, gagalList.length ? "warning" : "success");
  if (gagalList.length) console.warn("Gagal kirim slip ke:", gagalList);
  logAudit("Kirim Semua Slip Otomatis", `${sukses} sukses, ${gagalList.length} gagal dari ${target.length} karyawan (${entitasLabel})`);
}

// Cari karyawan berdasarkan NIK atau WA dalam lingkup perusahaan aktif
function cariDanKirimSlip() {
  const inputEl = document.getElementById("inputCariNomorSlip");
  const raw = (inputEl?.value || "").trim();
  if (!raw) return showToast("Masukkan nomor karyawan (NIK) atau nomor WhatsApp.", "info");

  const filteredK = getFilteredKaryawan();
  const normalizedDigits = raw.replace(/\D/g, "");
  const cocok = filteredK.filter((k) => {
    const nik = (k.nik || "").toUpperCase();
    const waDigits = (k.nomor_wa || "").replace(/\D/g, "");
    return (
      nik.includes(raw.toUpperCase()) ||
      (normalizedDigits.length >= 4 && (nik.replace(/\D/g, "").includes(normalizedDigits) || waDigits.includes(normalizedDigits)))
    );
  });

  if (cocok.length === 0) return showToast(`Karyawan dengan nomor "${raw}" tidak ditemukan di ${ACTIVE_COMPANY === 'ALL' ? 'database' : ACTIVE_COMPANY}.`, "error");
  if (cocok.length > 1) return showToast(`Ditemukan ${cocok.length} karyawan cocok, perjelas nomornya.`, "info");

  kirimSlipOtomatis(cocok[0]);
  if (inputEl) inputEl.value = "";
}

// --- UTILS & UX ---
// Cegah XSS: karyawan bisa isi teks bebas untuk lokasi "Dinas Luar" (script.js
// showModernPrompt) yang tersimpan di logs.status - kalau ditampilkan lewat
// innerHTML tanpa di-escape, kode HTML/script di dalamnya bisa ikut jalan di
// browser admin. Pakai fungsi ini untuk SEMUA teks dari user sebelum masuk innerHTML.
// Status "MASUK" DAN "DINAS LUAR" sama-sama menandai karyawan hadir/masuk
// kerja (lihat script.js prosesAbsen) - perbandingan persis "=== 'MASUK'" di
// banyak tempat Dashboard membuat karyawan yang absen via Dinas Luar hilang
// dari statistik kehadiran/keterlambatan padahal tetap dibayar hari itu.
function isMasukStatus(status) {
  const s = (status || "").toUpperCase();
  if (s.includes("TIDAK MASUK") || s.includes("ALPHA") || s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI") || s.includes("PULANG")) {
    return false;
  }
  return s.startsWith("MASUK") || s.startsWith("DINAS LUAR") || s.startsWith("BERANGKAT");
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showLoading(show) {
  document.getElementById("loadingOverlay").style.display = show ? "flex" : "none";
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

async function logAudit(action, details = "") {
  await supabaseClient.from("audit_logs").insert([{ action, details }]);
}

function notifikasiCEOPayroll(deptFilter = "ALL") {
  const tglMulai = document.getElementById("filterTglMulai")?.value;
  const tglSelesai = document.getElementById("filterTglSelesai")?.value;

  // Format Tanggal untuk Pesan
  const fmt = (d) => d ? d.split('-').reverse().join('/') : '-';
  const periodeTampil = (tglMulai && tglSelesai) ? `${fmt(tglMulai)} - ${fmt(tglSelesai)}` : "Bulan Ini";

  let totalTHP = 0;
  let rincianKaryawan = "";
  let count = 0;

  const baseKar = getFilteredKaryawan();
  const filteredKar = deptFilter === "ALL"
    ? baseKar
    : baseKar.filter(k => k.dept.toUpperCase() === deptFilter.toUpperCase());

  if (filteredKar.length === 0) return showToast(`Tidak ada data karyawan ${deptFilter} untuk periode ini.`, "info");

  filteredKar.forEach((k) => {
    const d = hitungDetailGaji(k.gaji, k.nama);
    const isApproved = k.is_incentive_approved === true;
    const insentifVal = isApproved ? (parseFloat(k.incentive_approved_val) || 0) : 0;

    totalTHP += d.thp;
    count++;

    rincianKaryawan += `${count}. *${k.nama}* (${k.dept} - ${getCompanyOfKaryawan(k)})\n`;
    rincianKaryawan += `   - GAJI POKOK: Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - PINJAMAN KANTOR: Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - HKE (${d.hadir} hari): Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - INCENTIVE: Rp ${insentifVal.toLocaleString('id-ID')} ${isApproved ? '✅' : '❌'}\n`;
    rincianKaryawan += `   - INCENTIVE (LK/NGINAP): Rp ${Math.floor(d.incentiveLuar || 0).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - OVERTIME (${d.totalLembur} jam @ Rp ${d.tarifLembur.toLocaleString('id-ID')}): Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - *Total THP: Rp ${Math.floor(d.thp).toLocaleString('id-ID')}*\n\n`;
  });

  const entitasTitle = ACTIVE_COMPANY === "ALL" ? "HOLDING (MULTI-COMPANY)" : ACTIVE_COMPANY.toUpperCase();
  let pesan = `*LAPORAN REKAP PAYROLL - ${deptFilter.toUpperCase()}*\n`;
  pesan += `${entitasTitle}\n`;
  pesan += `Periode: ${periodeTampil}\n`;
  pesan += `----------------------------------\n\n`;
  pesan += `*DETAIL PER KARYAWAN:*\n`;
  pesan += rincianKaryawan;
  pesan += `----------------------------------\n`;
  pesan += `*TOTAL ESTIMASI DANA: Rp ${Math.floor(totalTHP).toLocaleString('id-ID')}*\n`;
  pesan += `----------------------------------\n`;
  pesan += `_Laporan disesuaikan dengan entitas ${entitasTitle} & departemen ${deptFilter}_.\n\n`;
  pesan += `Review Detail: ${window.location.href}`;

  const url = `https://wa.me/${CEO_PHONE}?text=${encodeURIComponent(pesan)}`;
  window.open(url, '_blank');
  logAudit(`Notif CEO ${deptFilter}`, `Mengirim rekap payroll ${deptFilter} periode ${periodeTampil} (${entitasTitle})`);
}
function showModal() {
  document.getElementById("modalTitle").innerText = "Tambah Karyawan (Master Data)";
  document.getElementById("editKaryawanId").value = "";
  document.getElementById("btnSimpanKaryawan").innerText = "Simpan Master Data";

  // Reset Form
  const fields = ["inpNama", "inpNikKtp", "inpWa", "inpJabatan", "inpCuti", "inpNikKbi", "inpIsLembur", "inpTarifLembur", "inpLemburAdj", "inpPin", "inpGaji", "inpHkeRate", "inpIncentive", "inpIncentiveLuar", "inpRekening", "inpNpwp", "inpPinjaman", "inpPph21"];
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) {
      if (f === "inpCuti") el.value = 12;
      else if (f === "inpHkeRate") el.value = 50000;
      else if (f === "inpIsLembur") el.value = "true";
      else if (f === "inpLemburAdj" || f === "inpPinjaman" || f === "inpPph21" || f === "inpIncentive" || f === "inpIncentiveLuar") el.value = 0;
      else el.value = "";
    }
  });
  document.getElementById("inpDept").value = "OFFICE";
  document.getElementById("inpPtkp").value = "TK/0";

  const inpPerusahaan = document.getElementById("inpPerusahaan");
  if (inpPerusahaan) {
    if (ACTIVE_COMPANY && ACTIVE_COMPANY !== "ALL") {
      inpPerusahaan.value = ACTIVE_COMPANY;
    } else {
      inpPerusahaan.value = "PT. Kola Borasi Indonesia";
    }
    if (ADMIN_USER?.company_access && ADMIN_USER.company_access !== "ALL") {
      inpPerusahaan.disabled = true;
    } else {
      inpPerusahaan.disabled = false;
    }
  }

  const inpFoto = document.getElementById("inpFoto");
  if (inpFoto) inpFoto.value = "";
  const previewFoto = document.getElementById("previewFotoKaryawan");
  if (previewFoto) previewFoto.src = "https://ui-avatars.com/api/?name=?&background=e2e8f0&color=94a3b8";

  document.getElementById("modalKaryawan").style.display = "flex";
}

function hideModal() { document.getElementById("modalKaryawan").style.display = "none"; }

// Tampilkan preview instan saat admin memilih file foto, sebelum di-upload.
function previewFotoKaryawanInput(event) {
  const file = event.target.files?.[0];
  const previewFoto = document.getElementById("previewFotoKaryawan");
  if (file && previewFoto) previewFoto.src = URL.createObjectURL(file);
}

async function simpanKaryawan() {
  const id = document.getElementById("editKaryawanId").value;
  const targetPerusahaan = document.getElementById("inpPerusahaan")?.value || "PT. Kola Borasi Indonesia";
  const customTarifLembur = parseFloat(document.getElementById("inpTarifLembur")?.value);

  const data = {
    nama: document.getElementById("inpNama").value.toUpperCase(),
    nik_ktp: document.getElementById("inpNikKtp").value,
    nomor_wa: document.getElementById("inpWa").value,
    dept: document.getElementById("inpDept").value,
    jabatan: document.getElementById("inpJabatan").value.toUpperCase(),
    sisa_cuti: parseInt(document.getElementById("inpCuti").value) || 0,
    nik: document.getElementById("inpNikKbi").value,
    perusahaan: targetPerusahaan,
    is_lembur: document.getElementById("inpIsLembur").value === "true",
    lembur_adj: parseFloat(document.getElementById("inpLemburAdj").value) || 0,
    pin: document.getElementById("inpPin").value,
    gaji: parseFloat(document.getElementById("inpGaji").value) || 0,
    hke_rate: parseFloat(document.getElementById("inpHkeRate").value) || 0,
    incentive: parseFloat(document.getElementById("inpIncentive").value) || 0,
    incentive_luar: parseFloat(document.getElementById("inpIncentiveLuar").value) || 0,
    rekening: document.getElementById("inpRekening").value,
    status_ptkp: document.getElementById("inpPtkp").value,
    npwp: document.getElementById("inpNpwp").value,
    pinjaman: parseFloat(document.getElementById("inpPinjaman").value) || 0,
    pph21: parseFloat(document.getElementById("inpPph21").value) || 0
  };

  if (!isNaN(customTarifLembur) && customTarifLembur > 0) {
    data.tarif_lembur = customTarifLembur;
  }

  if (!data.nama || !data.gaji) return alert("Harap isi Nama dan Gaji Pokok!");

  showLoading(true);
  try {
    const fotoFile = document.getElementById("inpFoto")?.files?.[0];
    if (fotoFile) {
      const ext = fotoFile.name.split('.').pop() || 'jpg';
      const path = `${data.nik || 'karyawan'}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabaseClient.storage
        .from("foto-karyawan")
        .upload(path, fotoFile, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabaseClient.storage.from("foto-karyawan").getPublicUrl(path);
      data.foto_url = pub.publicUrl;
    }

    if (id) {
      let updateRes = await supabaseClient.from("karyawan").update(data).eq("id", id);
      if (updateRes.error && updateRes.error.message && updateRes.error.message.includes("tarif_lembur")) {
        delete data.tarif_lembur;
        updateRes = await supabaseClient.from("karyawan").update(data).eq("id", id);
      }
      if (updateRes.error) throw updateRes.error;
      showToast("Data karyawan berhasil diperbarui", "success");
      logAudit("Edit Karyawan", `Mengubah data karyawan: ${data.nama} (${data.perusahaan})`);
    } else {
      if (!data.nik) {
        let prefix = "KBI-";
        if (data.perusahaan === "PT. Fortune Reef Zona") prefix = "FRZ-";
        else if (data.perusahaan === "Mitra Belanja") prefix = "MB-";
        data.nik = prefix + Date.now().toString().slice(-6);
      }
      let insertRes = await supabaseClient.from("karyawan").insert([data]);
      if (insertRes.error && insertRes.error.message && insertRes.error.message.includes("tarif_lembur")) {
        delete data.tarif_lembur;
        insertRes = await supabaseClient.from("karyawan").insert([data]);
      }
      if (insertRes.error) throw insertRes.error;
      showToast("Karyawan baru berhasil ditambahkan", "success");
      logAudit("Tambah Karyawan", `Menambahkan karyawan baru: ${data.nama} (${data.perusahaan})`);
    }
    hideModal();
    syncData();
  } catch (err) {
    showToast("Gagal menyimpan: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

function bukaModalEditKaryawan(idOrIndex) {
  let k;
  if (typeof idOrIndex === "object" && idOrIndex !== null) {
    k = idOrIndex;
  } else if (typeof idOrIndex === "string" || typeof idOrIndex === "number") {
    k = KARYAWAN.find(x => String(x.id) === String(idOrIndex)) || KARYAWAN[idOrIndex];
  }
  if (!k) return;

  document.getElementById("modalTitle").innerText = "Edit Master Data: " + k.nama;
  document.getElementById("editKaryawanId").value = k.id;
  document.getElementById("btnSimpanKaryawan").innerText = "Simpan Perubahan";

  // Populate Fields
  document.getElementById("inpNama").value = k.nama || "";
  document.getElementById("inpNikKtp").value = k.nik_ktp || "";
  document.getElementById("inpWa").value = k.nomor_wa || "";
  document.getElementById("inpDept").value = k.dept || "OFFICE";
  document.getElementById("inpJabatan").value = k.jabatan || "";
  document.getElementById("inpCuti").value = k.sisa_cuti || 0;
  document.getElementById("inpNikKbi").value = k.nik || "";
  document.getElementById("inpIsLembur").value = k.is_lembur !== false ? "true" : "false";
  document.getElementById("inpLemburAdj").value = k.lembur_adj || 0;
  document.getElementById("inpPin").value = k.pin || "";
  document.getElementById("inpGaji").value = k.gaji || 0;
  document.getElementById("inpHkeRate").value = k.hke_rate || 50000;
  document.getElementById("inpIncentive").value = k.incentive || 0;
  document.getElementById("inpIncentiveLuar").value = k.incentive_luar || 0;
  document.getElementById("inpRekening").value = k.rekening || "";
  document.getElementById("inpPtkp").value = k.status_ptkp || "TK/0";
  document.getElementById("inpNpwp").value = k.npwp || "";
  document.getElementById("inpPinjaman").value = k.pinjaman || 0;
  document.getElementById("inpPph21").value = k.pph21 || 0;

  const inpTarifLembur = document.getElementById("inpTarifLembur");
  if (inpTarifLembur) {
    inpTarifLembur.value = (k.tarif_lembur && parseFloat(k.tarif_lembur) > 0) ? k.tarif_lembur : "";
  }

  const inpPerusahaan = document.getElementById("inpPerusahaan");
  if (inpPerusahaan) {
    inpPerusahaan.value = k.perusahaan || getCompanyOfKaryawan(k);
    if (ADMIN_USER?.company_access && ADMIN_USER.company_access !== "ALL") {
      inpPerusahaan.disabled = true;
    } else {
      inpPerusahaan.disabled = false;
    }
  }

  const inpFoto = document.getElementById("inpFoto");
  if (inpFoto) inpFoto.value = "";
  const previewFoto = document.getElementById("previewFotoKaryawan");
  if (previewFoto) {
    previewFoto.src = getEmployeeAvatar(k);
    previewFoto.onerror = () => { previewFoto.onerror = null; previewFoto.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(k.nama)}&background=4f46e5&color=fff`; };
  }

  document.getElementById("modalKaryawan").style.display = "flex";
}

async function hapusKaryawan(id) {
  const k = KARYAWAN.find(x => String(x.id) === String(id));
  const namaKaryawan = k ? k.nama : `ID ${id}`;
  if (!confirm(`Hapus karyawan "${namaKaryawan}" secara permanen?`)) return;

  showLoading(true);
  try {
    // 1. Lepas relasi foreign key di tabel logs agar tidak melanggar constraint logs_karyawan_id_fkey (HTTP 409)
    // Menjadikan karyawan_id null tetap mempertahankan riwayat absensi historis tanpa error constraint
    const { error: errLogs } = await supabaseClient
      .from("logs")
      .update({ karyawan_id: null })
      .eq("karyawan_id", id);
    if (errLogs) console.warn("Peringatan unbind logs:", errLogs);

    // 2. Bersihkan referensi cuti & review performa jika ada
    await supabaseClient.from("leave_requests").delete().eq("employee_id", id);
    await supabaseClient.from("performance_reviews").delete().eq("employee_id", id);
    await supabaseClient.from("kpi_snapshots").delete().eq("employee_id", id);

    // 3. Hapus data master karyawan
    const { error } = await supabaseClient.from("karyawan").delete().eq("id", id);
    if (error) throw error;

    showToast(`Karyawan ${namaKaryawan} berhasil dihapus`, "success");
    logAudit("Hapus Karyawan", `Menghapus karyawan: ${namaKaryawan}`);
    await syncData();
  } catch (err) {
    showToast("Gagal menghapus: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

function setPeriodeKPI(type) {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const fmt = (d) => d.toISOString().split('T')[0];

  const inpStart = document.getElementById("kpiFilterTglMulai");
  const inpEnd = document.getElementById("kpiFilterTglSelesai");

  if (inpStart && inpEnd) {
    inpStart.value = fmt(firstDay);
    inpEnd.value = fmt(lastDay);
    renderKPITable();
  }
}

function exportKPIReport() {
  const customStart = document.getElementById("kpiFilterTglMulai")?.value;
  const customEnd = document.getElementById("kpiFilterTglSelesai")?.value;
  const fmtDate = (d) => d ? d.split('-').reverse().join('/') : '-';
  const periodeTampil = (customStart && customEnd) ? `${fmtDate(customStart)} - ${fmtDate(customEnd)}` : "Bulan Berjalan";

  if (!KARYAWAN.length) return alert("Tidak ada data untuk laporan!");

  showLoading(true);

  // Hitung Data Summary
  let totalRate = 0;
  let totalLemburAll = 0;
  const listKPI = KARYAWAN.map(k => {
    const d = hitungDetailGaji(k.gaji, k.nama, customStart, customEnd);
    const rate = ((d.hadir / d.totalHariKerja) * 100) || 0;
    totalRate += rate;
    totalLemburAll += parseFloat(d.totalLembur) || 0;

    let logsKar = allLogs.filter(l => (l.nama || '').trim().toLowerCase() === k.nama.trim().toLowerCase() && isMasukStatus(l.status));
    if (customStart && customEnd) {
      const start = new Date(customStart + "T00:00:00");
      const end = new Date(customEnd + "T23:59:59");
      logsKar = logsKar.filter(l => {
        const w = new Date(l.waktu);
        return w >= start && w <= end;
      });
    }
    const lateCount = logsKar.filter(l => l.isLate).length;

    let statusLabel = "GOOD";
    let statusColor = "#10b981";
    if (rate >= 95 && lateCount === 0) { statusLabel = "EXCELLENT"; statusColor = "#4f46e5"; }
    else if (rate >= 85 && lateCount <= 2) { statusLabel = "GOOD"; statusColor = "#10b981"; }
    else if (rate >= 75 || lateCount <= 4) { statusLabel = "AVERAGE"; statusColor = "#f59e0b"; }
    else { statusLabel = "POOR"; statusColor = "#ef4444"; }

    return { ...k, d, rate, lateCount, statusLabel, statusColor };
  });

  const avgRate = (totalRate / KARYAWAN.length).toFixed(1);

  // Template HTML untuk PDF (Ultra-Compact Executive Version)
  const element = document.createElement('div');
  element.innerHTML = `
    <div style="padding: 15mm; font-family: 'Outfit', sans-serif; color: #1e293b; background: #fff; width: 180mm;">
      <!-- Header Ramping Satu Baris -->
      <header style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 15px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <img src="logokoboi.png" style="width: 35px; height: 35px;">
          <h1 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: #4f46e5;">PT. KOLA BORASI INDONESIA</h1>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.9rem; font-weight: 800; color: #1e293b;">KPI PERFORMANCE REPORT</div>
          <div style="font-size: 0.7rem; font-weight: 600; color: #64748b;">Periode: ${periodeTampil}</div>
        </div>
      </header>

      <!-- Summary Bar Ramping -->
      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
        <div style="flex: 1; background: #f8fafc; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.6rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Manpower</span>
          <span style="font-size: 0.9rem; font-weight: 800;">${KARYAWAN.length}</span>
        </div>
        <div style="flex: 1; background: #f8fafc; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.6rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Attendance</span>
          <span style="font-size: 0.9rem; font-weight: 800; color: #4f46e5;">${avgRate}%</span>
        </div>
        <div style="flex: 1; background: #f8fafc; padding: 8px; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.6rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Overtime</span>
          <span style="font-size: 0.9rem; font-weight: 800; color: #10b981;">${totalLemburAll.toFixed(1)}h</span>
        </div>
      </div>

      <!-- Tabel Ultra Compact -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
        <thead>
          <tr style="background: #f1f5f9;">
            <th style="padding: 6px 8px; text-align: left; font-size: 0.6rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Karyawan</th>
            <th style="padding: 6px 8px; text-align: center; font-size: 0.6rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Dept</th>
            <th style="padding: 6px 8px; text-align: center; font-size: 0.6rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Hadir (%)</th>
            <th style="padding: 6px 8px; text-align: center; font-size: 0.6rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Telat</th>
            <th style="padding: 6px 8px; text-align: center; font-size: 0.6rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Lembur</th>
            <th style="padding: 6px 8px; text-align: center; font-size: 0.6rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${listKPI.map((k, idx) => `
            <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
              <td style="padding: 4px 8px; border-bottom: 1px solid #f1f5f9;">
                <span style="font-weight: 800; font-size: 0.75rem;">${k.nama}</span>
                <span style="font-size: 0.6rem; color: #94a3b8; margin-left: 5px;">(${k.nik})</span>
              </td>
              <td style="padding: 4px 8px; text-align: center; border-bottom: 1px solid #f1f5f9; font-size: 0.7rem;">${k.dept}</td>
              <td style="padding: 4px 8px; text-align: center; border-bottom: 1px solid #f1f5f9; font-weight: 800; font-size: 0.75rem;">${k.rate.toFixed(1)}%</td>
              <td style="padding: 4px 8px; text-align: center; border-bottom: 1px solid #f1f5f9; font-size: 0.7rem; color: ${k.lateCount > 0 ? '#ef4444' : '#1e293b'}">${k.lateCount}x</td>
              <td style="padding: 4px 8px; text-align: center; border-bottom: 1px solid #f1f5f9; font-size: 0.7rem;">${k.d.totalLembur}h</td>
              <td style="padding: 4px 8px; text-align: center; border-bottom: 1px solid #f1f5f9;">
                <span style="background: ${k.statusColor}20; color: ${k.statusColor}; padding: 2px 6px; border-radius: 4px; font-size: 0.55rem; font-weight: 800;">
                  ${k.statusLabel}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- Footer Tipis -->
      <footer style="border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; align-items: center;">
        <div style="font-size: 0.6rem; color: #94a3b8;">Printed by KOBOI HRIS | ${new Date().toLocaleString('id-ID')}</div>
        <div style="font-size: 0.55rem; font-weight: 800; color: #ef4444; letter-spacing: 1px;">PRIVATE & CONFIDENTIAL</div>
      </footer>
    </div>
  `;

  const opt = {
    margin: 5,
    filename: `KPI_Report_OnePage.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 3, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    showLoading(false);
    showToast("Laporan Satu Halaman Berhasil", "success");
  });
}

function bukaModalEdit(id) {
  const log = logs.find((l) => l.id === id);
  if (!log) return;
  document.getElementById("editLogId").value = log.id;
  document.getElementById("editNama").value = log.nama;
  document.getElementById("editStatus").value = log.status;
  document.getElementById("editWaktu").value = new Date(log.waktu).toISOString().slice(0, 16);
  const editKet = document.getElementById("editKeterangan");
  if (editKet) editKet.value = log.keterangan || "";
  document.getElementById("modalEditAbsen").style.display = "flex";
}

function hideEditModal() { document.getElementById("modalEditAbsen").style.display = "none"; }

async function simpanPerubahanAbsen() {
  const id = document.getElementById("editLogId").value;
  const status = document.getElementById("editStatus").value;
  const waktuBaru = document.getElementById("editWaktu").value;
  const keteranganBaru = document.getElementById("editKeterangan")?.value?.trim() || null;
  let telat = false;
  const tglBaru = new Date(waktuBaru);
  // Gunakan toleransi 09:15 untuk status masuk / dinas luar / berangkat
  const statusUpper = (status || "").toUpperCase();
  if (statusUpper.startsWith("MASUK") || statusUpper.startsWith("DINAS LUAR") || statusUpper.startsWith("BERANGKAT")) {
    const hh = tglBaru.getHours();
    const mm = tglBaru.getMinutes();
    if (hh > STANDAR_MASUK || (hh === STANDAR_MASUK && mm > TOLERANSI_MASUK_MENIT)) telat = true;
  }
  const updatePayload = {
    status,
    waktu: tglBaru.toISOString(),
    isLate: telat,
    keterangan: keteranganBaru
  };
  showLoading(true);
  const { error } = await supabaseClient.from("logs").update(updatePayload).eq("id", id);
  showLoading(false);
  if (!error) {
    showToast("Log absensi berhasil diperbarui!", "success");
    hideEditModal();
    syncData();
  } else {
    showToast("Gagal menyimpan perubahan: " + error.message, "error");
  }
}

function zoomFoto(url) {
  const v = document.createElement("div");
  v.style = "position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;justify-content:center;align-items:center;z-index:9999;cursor:pointer;";
  v.onclick = () => v.remove();
  v.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; border-radius:12px;">`;
  document.body.appendChild(v);
}

// --- BATCH FETCHER SELURUH LOG TANPA BATAS 1000 BARIS ---
async function fetchAllLogsInRange(startDateStr, endDateStr, onProgress = null) {
  let allResults = [];
  let from = 0;
  const batchSize = 1000;
  
  // Kecualikan kolom 'foto' (base64) agar transfer data ultra-ringan & cepat (<3 detik untuk 5.500+ log)
  const selectCols = "id, nama, dept, waktu, status, isLate, is_late, keterangan, latitude, longitude, karyawan_id";

  while (true) {
    let q = supabaseClient
      .from("logs")
      .select(selectCols)
      .order("waktu", { ascending: true })
      .range(from, from + batchSize - 1);

    if (startDateStr && endDateStr) {
      q = q.gte("waktu", `${startDateStr}T00:00:00`).lte("waktu", `${endDateStr}T23:59:59`);
    } else if (startDateStr) {
      q = q.gte("waktu", `${startDateStr}T00:00:00`);
    }

    const { data, error } = await q;
    if (error) {
      console.error("Error fetching logs batch:", error);
      throw error;
    }
    if (!data || data.length === 0) break;

    allResults = allResults.concat(data);
    if (typeof onProgress === "function") {
      onProgress(allResults.length);
    }
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return allResults;
}

// --- KONTROL PRESET BULAN CEPAT DI TAB LOG ---
function onQuickBulanChange(val) {
  const now = new Date();
  const year = now.getFullYear();
  let startStr = "";
  let endStr = "";

  if (val === "YTD") {
    // 1 Januari tahun berjalan s/d hari ini
    startStr = `${year}-01-01`;
    endStr = toLocalISO(now).split("T")[0];
  } else if (val === "FULL_YEAR") {
    // 1 Januari s/d 31 Desember
    startStr = `${year}-01-01`;
    endStr = `${year}-12-31`;
  } else if (val === "INI") {
    // Bulan berjalan
    const firstDay = new Date(year, now.getMonth(), 1);
    const lastDay = new Date(year, now.getMonth() + 1, 0);
    startStr = toLocalISO(firstDay).split("T")[0];
    endStr = toLocalISO(lastDay).split("T")[0];
  } else if (val === "LALU") {
    // Bulan lalu
    const firstDay = new Date(year, now.getMonth() - 1, 1);
    const lastDay = new Date(year, now.getMonth(), 0);
    startStr = toLocalISO(firstDay).split("T")[0];
    endStr = toLocalISO(lastDay).split("T")[0];
  } else if (val === "CUSTOM") {
    document.getElementById("exportTglMulai")?.focus();
    return;
  } else if (!isNaN(val)) {
    // Pilihan Bulan 1 s/d 12
    const m = parseInt(val, 10);
    const firstDay = new Date(year, m - 1, 1);
    const lastDay = new Date(year, m, 0);
    startStr = `${year}-${String(m).padStart(2, "0")}-01`;
    endStr = `${year}-${String(m).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
  }

  const expMulai = document.getElementById("exportTglMulai");
  const expSelesai = document.getElementById("exportTglSelesai");
  if (expMulai) expMulai.value = startStr;
  if (expSelesai) expSelesai.value = endStr;

  const logMulai = document.getElementById("logFilterTglMulai");
  const logSelesai = document.getElementById("logFilterTglSelesai");
  if (logMulai) logMulai.value = startStr;
  if (logSelesai) logSelesai.value = endStr;
}

function syncExportDatesToFilter() {
  const m = document.getElementById("exportTglMulai")?.value;
  const s = document.getElementById("exportTglSelesai")?.value;
  if (m && document.getElementById("logFilterTglMulai")) document.getElementById("logFilterTglMulai").value = m;
  if (s && document.getElementById("logFilterTglSelesai")) document.getElementById("logFilterTglSelesai").value = s;
}

async function terapkanPeriodeKeTabel() {
  const m = document.getElementById("exportTglMulai")?.value;
  const s = document.getElementById("exportTglSelesai")?.value;
  if (!m || !s) return alert("Pilih tanggal mulai dan selesai terlebih dahulu!");
  
  if (document.getElementById("logFilterTglMulai")) document.getElementById("logFilterTglMulai").value = m;
  if (document.getElementById("logFilterTglSelesai")) document.getElementById("logFilterTglSelesai").value = s;
  
  showToast(`Menerapkan filter tabel: ${m} s/d ${s}...`, "info");
  await syncData();
}

// --- MODAL TARIKAN EXCEL LENGKAP ---
function bukaModalTarikanExcel() {
  const modal = document.getElementById("modalExportExcel");
  if (!modal) return;

  const now = new Date();
  const year = now.getFullYear();
  const expMulai = document.getElementById("exportTglMulai")?.value || `${year}-01-01`;
  const expSelesai = document.getElementById("exportTglSelesai")?.value || toLocalISO(now).split("T")[0];

  const modalStart = document.getElementById("modalExpTglMulai");
  const modalEnd = document.getElementById("modalExpTglSelesai");
  if (modalStart) modalStart.value = expMulai;
  if (modalEnd) modalEnd.value = expSelesai;

  const modalComp = document.getElementById("modalExpCompany");
  if (modalComp) {
    if (ADMIN_USER?.company_access && ADMIN_USER.company_access !== "ALL") {
      modalComp.value = ADMIN_USER.company_access;
      modalComp.disabled = true;
    } else {
      modalComp.value = ACTIVE_COMPANY || "ALL";
      modalComp.disabled = false;
    }
  }

  // Populate Karyawan Select
  const selKar = document.getElementById("modalExpKaryawan");
  if (selKar) {
    let options = `<option value="ALL">👥 Semua Karyawan</option>`;
    const targetKar = getFilteredKaryawan();
    targetKar.forEach(k => {
      options += `<option value="${k.id}">${k.nama} (${k.nik || '-'}) - ${k.dept || '-'}</option>`;
    });
    selKar.innerHTML = options;
  }

  // Sync state kartu sheet
  syncSheetCard("chkSheetSummary", "cardSheetSummary");
  syncSheetCard("chkSheetLogs", "cardSheetLogs");
  syncSheetCard("chkSheetMonthly", "cardSheetMonthly");
  syncSheetCard("chkSheetTimesheet", "cardSheetTimesheet");
  syncSheetCard("chkSheetAbsence", "cardSheetAbsence");

  const pBox = document.getElementById("modalExpProgressBox");
  if (pBox) pBox.style.display = "none";

  modal.style.display = "flex";
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function tutupModalTarikanExcel() {
  const modal = document.getElementById("modalExportExcel");
  if (modal) modal.style.display = "none";
}

function setModalExpPreset(preset, btn = null) {
  const now = new Date();
  const year = now.getFullYear();
  let startStr = "";
  let endStr = "";

  if (preset === "ytd") {
    startStr = `${year}-01-01`;
    endStr = toLocalISO(now).split("T")[0];
  } else if (preset === "full") {
    startStr = `${year}-01-01`;
    endStr = `${year}-12-31`;
  } else if (preset === "ini") {
    const firstDay = new Date(year, now.getMonth(), 1);
    const lastDay = new Date(year, now.getMonth() + 1, 0);
    startStr = toLocalISO(firstDay).split("T")[0];
    endStr = toLocalISO(lastDay).split("T")[0];
  } else if (preset === "lalu") {
    const firstDay = new Date(year, now.getMonth() - 1, 1);
    const lastDay = new Date(year, now.getMonth(), 0);
    startStr = toLocalISO(firstDay).split("T")[0];
    endStr = toLocalISO(lastDay).split("T")[0];
  }

  const modalStart = document.getElementById("modalExpTglMulai");
  const modalEnd = document.getElementById("modalExpTglSelesai");
  if (modalStart) modalStart.value = startStr;
  if (modalEnd) modalEnd.value = endStr;

  // Update visual state tombol preset
  document.querySelectorAll(".exp-preset-btn").forEach(b => b.classList.remove("active"));
  if (btn) {
    btn.classList.add("active");
  } else {
    const match = document.querySelector(`.exp-preset-btn[data-preset="${preset}"]`);
    if (match) match.classList.add("active");
  }
}

function toggleSheetCard(chkId, cardId) {
  const chk = document.getElementById(chkId);
  if (!chk) return;
  chk.checked = !chk.checked;
  syncSheetCard(chkId, cardId);
}

function syncSheetCard(chkId, cardId) {
  const chk = document.getElementById(chkId);
  const card = document.getElementById(cardId);
  if (card && chk) {
    card.classList.toggle("selected", chk.checked);
  }
}

function jalankanTarikanExcelDariModal() {
  const tglMulai = document.getElementById("modalExpTglMulai")?.value;
  const tglSelesai = document.getElementById("modalExpTglSelesai")?.value;
  const company = document.getElementById("modalExpCompany")?.value || "ALL";
  const karyawanId = document.getElementById("modalExpKaryawan")?.value || "ALL";

  const includeSummary = document.getElementById("chkSheetSummary")?.checked !== false;
  const includeLogs = document.getElementById("chkSheetLogs")?.checked !== false;
  const includeMonthly = document.getElementById("chkSheetMonthly")?.checked !== false;
  const includeTimesheet = document.getElementById("chkSheetTimesheet")?.checked !== false;
  const includeAbsence = document.getElementById("chkSheetAbsence")?.checked !== false;

  jalankanTarikanExcel({
    tglMulai,
    tglSelesai,
    company,
    karyawanId,
    includeSummary,
    includeLogs,
    includeMonthly,
    includeTimesheet,
    includeAbsence,
    isFromModal: true
  });
}

function cetakLaporanDariModal() {
  const tglMulai = document.getElementById("modalExpTglMulai")?.value;
  const tglSelesai = document.getElementById("modalExpTglSelesai")?.value;
  const company = document.getElementById("modalExpCompany")?.value || "ALL";
  const karyawanId = document.getElementById("modalExpKaryawan")?.value || "ALL";

  cetakLaporanRekapitulasi({
    tglMulai,
    tglSelesai,
    company,
    karyawanId
  });
}

// --- FUNGSI EKSEKUSI TARIKAN EXCEL UTAMA ---
async function jalankanTarikanExcel(customParams = {}) {
  const now = new Date();
  const year = now.getFullYear();
  const todayStr = toLocalISO(now).split("T")[0];

  const tglMulai = customParams.tglMulai || 
    document.getElementById("exportTglMulai")?.value || 
    document.getElementById("logFilterTglMulai")?.value || 
    `${year}-01-01`;

  const tglSelesai = customParams.tglSelesai || 
    document.getElementById("exportTglSelesai")?.value || 
    document.getElementById("logFilterTglSelesai")?.value || 
    todayStr;

  let targetCompany = customParams.company || 
    document.getElementById("exportSelectCompany")?.value || 
    ACTIVE_COMPANY || "ALL";

  if (ADMIN_USER?.company_access && ADMIN_USER.company_access !== "ALL") {
    targetCompany = ADMIN_USER.company_access;
  }

  const selectedKaryawanId = customParams.karyawanId || "ALL";
  const searchInputRaw = (document.getElementById("logSearchInput")?.value || "").trim();
  const isLogTab = document.getElementById("tabLog")?.style.display !== "none";
  const searchKeyword = (!customParams.isFromModal && isLogTab) ? searchInputRaw.toLowerCase() : "";

  // Update progress feedback
  const pBox = document.getElementById("modalExpProgressBox");
  const pText = document.getElementById("modalExpProgressText");
  if (pBox && pText) {
    pBox.style.display = "block";
    pText.innerText = `Menghubungi server... Mengambil data dari ${tglMulai} s/d ${tglSelesai}`;
  }

  showLoading(true);
  showToast(`Sedang menarik data absensi (${tglMulai} s/d ${tglSelesai})...`, "info");

  try {
    // 1. Tarik seluruh log dari Supabase tanpa batasan 1.000 baris
    const fetchedLogs = await fetchAllLogsInRange(tglMulai, tglSelesai, (count) => {
      const msg = `Mengambil data dari server... (${count.toLocaleString("id-ID")} log terambil)`;
      if (pText) pText.innerText = msg;
      showLoading(msg);
    });

    if (!fetchedLogs || fetchedLogs.length === 0) {
      showLoading(false);
      if (pBox) pBox.style.display = "none";
      return alert(`Tidak ditemukan data absensi pada periode ${tglMulai} s/d ${tglSelesai}!`);
    }

    if (pText) pText.innerText = `Mengkalkulasi kehadiran & payroll untuk ${KARYAWAN.length} karyawan...`;

    // 2. Tentukan target karyawan
    let targetKaryawanList = KARYAWAN;
    if (targetCompany && targetCompany !== "ALL") {
      targetKaryawanList = targetKaryawanList.filter(k => getCompanyOfKaryawan(k) === targetCompany);
    }

    if (selectedKaryawanId && selectedKaryawanId !== "ALL") {
      targetKaryawanList = targetKaryawanList.filter(k => String(k.id) === String(selectedKaryawanId));
    }

    if (searchKeyword) {
      targetKaryawanList = targetKaryawanList.filter(k => 
        (k.nama || "").toLowerCase().includes(searchKeyword) ||
        (k.nik || "").toLowerCase().includes(searchKeyword)
      );

      if (targetKaryawanList.length === 0) {
        const matchingLogNames = [...new Set(
          fetchedLogs
            .filter(l => (l.nama || "").toLowerCase().includes(searchKeyword))
            .map(l => (l.nama || "").trim())
        )];
        targetKaryawanList = matchingLogNames.map(name => {
          const existingK = KARYAWAN.find(x => x.nama.trim().toLowerCase() === name.toLowerCase());
          return existingK || { nama: name, nik: "-", jabatan: "-", dept: "-", gaji: 0, perusahaan: targetCompany !== "ALL" ? targetCompany : "-" };
        });
      }
    }

    const totalHariKerja = hitungHariKerjaEfektif(tglMulai, tglSelesai);

    // --- SHEET 1: REKAPITULASI PAYROLL & KEHADIRAN ---
    const dataSummary = targetKaryawanList.map((k, idx) => {
      const d = hitungDetailGaji(k.gaji || 0, k.nama, tglMulai, tglSelesai, fetchedLogs);
      const persentaseHadir = totalHariKerja > 0 ? ((d.hadir / totalHariKerja) * 100).toFixed(1) + "%" : "0%";
      const hariTidakMasuk = Math.max(0, totalHariKerja - (d.hadir || 0));
      return {
        "NO": idx + 1,
        "PERUSAHAAN": getCompanyOfKaryawan(k),
        "NIK": k.nik || "-",
        "NAMA KARYAWAN": k.nama,
        "JABATAN": k.jabatan || "-",
        "DEPARTEMEN": k.dept || "-",
        "NO. REKENING": k.rekening || "-",
        "PERIODE LAPORAN": `${tglMulai} s/d ${tglSelesai}`,
        "HARI KERJA EFEKTIF": totalHariKerja,
        "HARI HADIR": d.hadir,
        "HARI TIDAK MASUK (ALPHA)": hariTidakMasuk,
        "% KEHADIRAN": persentaseHadir,
        "TOTAL JAM KERJA (JAM)": d.totalJamKerja || 0,
        "HARI TERLAMBAT": d.telat || 0,
        "TOTAL JAM LEMBUR": parseFloat(d.totalLembur) || 0,
        "TARIF LEMBUR / JAM (RP)": d.tarifLembur || 0,
        "DASAR RUMUS LEMBUR": d.keteranganTarifLembur || "-",
        "UANG LEMBUR (RP)": d.uangLembur || 0,
        "GAJI POKOK (RP)": Math.floor(d.gapok || 0),
        "KETERANGAN SKEMA GAJI": d.keteranganGapok || (d.isWeeklyScheme ? "Mingguan" : "Bulanan"),
        "INCENTIVE CEO (RP)": d.incentive || 0,
        "INCENTIVE LUAR (RP)": d.incentiveLuar || 0,
        "POTONGAN PINJAMAN (RP)": Math.floor(d.totalPotongan || d.pinjaman || 0),
        "TOTAL GAJI BERSIH / THP (RP)": Math.floor(d.thp || 0)
      };
    });

    // --- SHEET 2: DETAIL LOG ABSENSI LENGKAP ---
    const allowedEmployeeNames = new Set(targetKaryawanList.map(k => (k.nama || "").trim().toLowerCase()));
    const filteredLogsForExport = fetchedLogs.filter(l => {
      const norm = (l.nama || "").trim().toLowerCase();
      return allowedEmployeeNames.has(norm);
    });

    const getShiftDateStrExport = (dateObj) => {
      const d = new Date(dateObj.getTime() - 4 * 3600000);
      return d.toLocaleDateString("id-ID");
    };

    const getHariIndonesia = (dateObj) => {
      const hari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
      return hari[dateObj.getDay()];
    };

    const logGroups = {};
    filteredLogsForExport.forEach(l => {
      const norm = (l.nama || "").trim().toLowerCase();
      if (!logGroups[norm]) logGroups[norm] = [];
      logGroups[norm].push(l);
    });

    const dataLogs = [];
    let logSeq = 1;

    Object.keys(logGroups).forEach(normKey => {
      const userLogs = logGroups[normKey].sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
      let i = 0;
      while (i < userLogs.length) {
        const l = userLogs[i];
        const waktu = new Date(l.waktu);
        let jamLembur = 0;
        const statusUpper = l.status.toUpperCase();

        const karObj = KARYAWAN.find(x => (x.nama || "").trim().toLowerCase() === (l.nama || "").trim().toLowerCase());
        const compName = karObj ? getCompanyOfKaryawan(karObj) : (targetCompany !== "ALL" ? targetCompany : "-");
        const nikKar = karObj?.nik || "-";

        if (statusUpper.startsWith("MASUK") || statusUpper.startsWith("BERANGKAT") || statusUpper.startsWith("DINAS LUAR")) {
          const actualMasuk = waktu;
          const thresholdMasuk = getWIBThreshold(actualMasuk, STANDAR_MASUK);

          const isAdminRole = karObj && (
            (karObj.jabatan || "").toUpperCase().includes("ADMIN") ||
            (karObj.dept || "").toUpperCase().includes("ADMIN")
          );
          const isOffice = karObj && (
            (karObj.dept && (karObj.dept.toUpperCase().includes("OFFICE") || karObj.dept.toUpperCase().includes("FINANCE"))) ||
            isAdminRole
          );
          const currentStdPulangExport = isOffice ? 18 : 17;

          let j = i + 1;
          while (j < userLogs.length && userLogs[j].status.toUpperCase().startsWith("PULANG")) {
            j++;
          }

          if (actualMasuk < thresholdMasuk) {
            jamLembur = (thresholdMasuk - actualMasuk) / (1000 * 60 * 60);
          }

          let jamSore = 0;
          let lastPulangIdx = -1;
          for (let k = i + 1; k < j; k++) {
            if (k === j - 1) {
              const lp = userLogs[k];
              const wp = new Date(lp.waktu);
              const thresholdPulang = getWIBThreshold(actualMasuk, currentStdPulangExport);
              const diffSore = (wp - thresholdPulang) / (1000 * 60 * 60);
              if (diffSore > 0) jamSore = diffSore;
              lastPulangIdx = k;
            }
          }

          let lemburPagiVal = jamLembur > 0 ? jamLembur : 0;
          let lemburSoreVal = jamSore > 0 ? jamSore : 0;
          let totalShiftLembur = lemburPagiVal + lemburSoreVal;

          if (isAdminRole && totalShiftLembur > 1) {
            if (lemburPagiVal >= 1) {
              lemburPagiVal = 1;
              lemburSoreVal = 0;
            } else {
              lemburSoreVal = 1 - lemburPagiVal;
            }
          }

          const lateInfo = hitungDetailKeterlambatan(l);
          const tarifLemburKaryawan = getTarifLemburKaryawan(karObj);
          const uangLemburPagi = Math.round(lemburPagiVal * tarifLemburKaryawan);

          dataLogs.push({
            "NO": logSeq++,
            "PERUSAHAAN": compName,
            "NIK": nikKar,
            "NAMA KARYAWAN": l.nama,
            "JABATAN": karObj?.jabatan || "-",
            "DEPARTEMEN": karObj?.dept || l.dept || "-",
            "TANGGAL SHIFT": getShiftDateStrExport(waktu),
            "HARI": getHariIndonesia(waktu),
            "WAKTU ABSEN": waktu.toLocaleString("id-ID"),
            "STATUS ABSEN": l.status,
            "STATUS KEHADIRAN": lateInfo.isLate ? "TERLAMBAT" : "TEPAT WAKTU",
            "TERLAMBAT": lateInfo.isLate ? "YA" : "TIDAK",
            "MENIT TERLAMBAT": lateInfo.isLate ? lateInfo.menitTelat : 0,
            "KETERANGAN KETERLAMBATAN": lateInfo.detail,
            "JAM LEMBUR (JAM)": lemburPagiVal > 0 ? parseFloat(lemburPagiVal.toFixed(2)) : 0,
            "TARIF LEMBUR / JAM (RP)": tarifLemburKaryawan,
            "ESTIMASI UANG LEMBUR (RP)": uangLemburPagi,
            "KETERANGAN / NOTE": l.keterangan || "-"
          });

          for (let k = i + 1; k < j; k++) {
            const lp = userLogs[k];
            const wp = new Date(lp.waktu);
            const lemburRow = (k === lastPulangIdx) ? lemburSoreVal : 0;
            const uangLemburSore = Math.round(lemburRow * tarifLemburKaryawan);
            dataLogs.push({
              "NO": logSeq++,
              "PERUSAHAAN": compName,
              "NIK": nikKar,
              "NAMA KARYAWAN": lp.nama,
              "JABATAN": karObj?.jabatan || "-",
              "DEPARTEMEN": karObj?.dept || lp.dept || "-",
              "TANGGAL SHIFT": getShiftDateStrExport(wp),
              "HARI": getHariIndonesia(wp),
              "WAKTU ABSEN": wp.toLocaleString("id-ID"),
              "STATUS ABSEN": lp.status,
              "STATUS KEHADIRAN": "PULANG",
              "TERLAMBAT": "-",
              "MENIT TERLAMBAT": 0,
              "KETERANGAN KETERLAMBATAN": "-",
              "JAM LEMBUR (JAM)": lemburRow > 0 ? parseFloat(lemburRow.toFixed(2)) : 0,
              "TARIF LEMBUR / JAM (RP)": tarifLemburKaryawan,
              "ESTIMASI UANG LEMBUR (RP)": uangLemburSore,
              "KETERANGAN / NOTE": lp.keterangan || "-"
            });
          }
          i = j;
        } else {
          const lateInfo = hitungDetailKeterlambatan(l);
          const tarifLemburKaryawan = getTarifLemburKaryawan(karObj);
          const sUpper = (l.status || "").toUpperCase();
          let statusKehadiran = "-";
          let terlambatStr = "-";

          if (sUpper.includes("TIDAK MASUK") || sUpper.includes("ALPHA")) {
            statusKehadiran = "TIDAK MASUK (ALPHA)";
            terlambatStr = "TIDAK";
          } else if (sUpper.includes("IZIN") || sUpper.includes("SAKIT") || sUpper.includes("CUTI")) {
            statusKehadiran = sUpper;
            terlambatStr = "TIDAK";
          } else if (isMasukStatus(l.status)) {
            statusKehadiran = lateInfo.isLate ? "TERLAMBAT" : "TEPAT WAKTU";
            terlambatStr = lateInfo.isLate ? "YA" : "TIDAK";
          }

          dataLogs.push({
            "NO": logSeq++,
            "PERUSAHAAN": compName,
            "NIK": nikKar,
            "NAMA KARYAWAN": l.nama,
            "JABATAN": karObj?.jabatan || "-",
            "DEPARTEMEN": karObj?.dept || l.dept || "-",
            "TANGGAL SHIFT": getShiftDateStrExport(waktu),
            "HARI": getHariIndonesia(waktu),
            "WAKTU ABSEN": waktu.toLocaleString("id-ID"),
            "STATUS ABSEN": l.status,
            "STATUS KEHADIRAN": statusKehadiran,
            "TERLAMBAT": terlambatStr,
            "MENIT TERLAMBAT": lateInfo.isLate ? lateInfo.menitTelat : 0,
            "KETERANGAN KETERLAMBATAN": lateInfo.detail,
            "JAM LEMBUR (JAM)": 0,
            "TARIF LEMBUR / JAM (RP)": tarifLemburKaryawan,
            "ESTIMASI UANG LEMBUR (RP)": 0,
            "KETERANGAN / NOTE": l.keterangan || "-"
          });
          i++;
        }
      }
    });

    // --- SHEET 3: BREAKDOWN BULANAN (Januari - Seterusnya) ---
    const dataMonthlyBreakdown = [];
    const namaBulanIndo = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const uniqueYearMonths = [...new Set(fetchedLogs.map(l => (l.waktu || "").slice(0, 7)).filter(Boolean))].sort();

    targetKaryawanList.forEach(k => {
      const compName = getCompanyOfKaryawan(k);
      uniqueYearMonths.forEach(ym => {
        const [y, mStr] = ym.split("-");
        const mIdx = parseInt(mStr, 10) - 1;
        const bulanNama = namaBulanIndo[mIdx] || ym;

        const logsBulanIni = fetchedLogs.filter(l => (l.waktu || "").startsWith(ym) && (l.nama || "").trim().toLowerCase() === k.nama.trim().toLowerCase());
        const startBulan = `${ym}-01`;
        const lastDateObj = new Date(parseInt(y, 10), mIdx + 1, 0);
        const endBulan = `${ym}-${String(lastDateObj.getDate()).padStart(2, "0")}`;

        const d = hitungDetailGaji(k.gaji || 0, k.nama, startBulan, endBulan, logsBulanIni);
        if (d.hadir > 0 || logsBulanIni.length > 0) {
          dataMonthlyBreakdown.push({
            "PERUSAHAAN": compName,
            "NIK": k.nik || "-",
            "NAMA KARYAWAN": k.nama,
            "BULAN": `${bulanNama} ${y}`,
            "HARI HADIR": d.hadir,
            "HARI TERLAMBAT": d.telat || 0,
            "TOTAL JAM LEMBUR": parseFloat(d.totalLembur) || 0,
            "TARIF LEMBUR / JAM (RP)": d.tarifLembur || 0,
            "UANG LEMBUR (RP)": d.uangLembur || 0,
            "GAJI POKOK (RP)": Math.floor(d.gapok || 0),
            "KETERANGAN SKEMA": d.keteranganGapok || (d.isWeeklyScheme ? "Mingguan" : "Bulanan"),
            "ESTIMASI THP BULAN INI (RP)": Math.floor(d.thp || 0)
          });
        }
      });
    });

    // --- SHEET 4: TIMESHEET MATRIKS KEHADIRAN (1 s/d 31) ---
    const [startYearNum, startMonthNum] = tglMulai.split("-").map(Number);
    const todayDateOnly = toLocalISO(new Date()).split("T")[0];

    const dataTimesheet = targetKaryawanList.map(k => {
      const row = {
        "PERUSAHAAN": getCompanyOfKaryawan(k),
        "NIK": k.nik || "-",
        "NAMA KARYAWAN": k.nama,
        "DEPARTEMEN": k.dept || "-"
      };
      const userLogs = fetchedLogs.filter(l => (l.nama || "").trim().toLowerCase() === k.nama.trim().toLowerCase());
      const presentDays = new Set(
        userLogs
          .filter(l => isMasukStatus(l.status))
          .map(l => {
            const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
            return toLocalISO(d).split("T")[0];
          })
      );

      const leaveDays = {};
      userLogs.forEach(l => {
        const s = (l.status || "").toUpperCase();
        if (s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI")) {
          const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
          const dStr = toLocalISO(d).split("T")[0];
          leaveDays[dStr] = s.includes("SAKIT") ? "S" : (s.includes("IZIN") ? "I" : "C");
        }
      });

      let countHadir = 0;
      let countAlpha = 0;
      let countLibur = 0;

      for (let day = 1; day <= 31; day++) {
        const dayStr = String(day).padStart(2, "0");
        const monthStr = String(startMonthNum || (now.getMonth() + 1)).padStart(2, "0");
        const curYearStr = String(startYearNum || year);
        const curDateStr = `${curYearStr}-${monthStr}-${dayStr}`;

        const dateObj = new Date(Number(curYearStr), Number(monthStr) - 1, day);
        if (dateObj.getMonth() !== (Number(monthStr) - 1)) {
          row[`TGL_${dayStr}`] = "";
          continue;
        }

        const isSunday = dateObj.getDay() === 0;

        if (presentDays.has(curDateStr)) {
          row[`TGL_${dayStr}`] = "H";
          countHadir++;
        } else if (leaveDays[curDateStr]) {
          row[`TGL_${dayStr}`] = leaveDays[curDateStr];
        } else if (isSunday) {
          row[`TGL_${dayStr}`] = "L";
          countLibur++;
        } else if (curDateStr <= todayDateOnly) {
          row[`TGL_${dayStr}`] = "A";
          countAlpha++;
        } else {
          row[`TGL_${dayStr}`] = "-";
        }
      }

      row["TOTAL HADIR (H)"] = countHadir;
      row["TOTAL TIDAK MASUK (A)"] = countAlpha;
      row["TOTAL LIBUR (L)"] = countLibur;

      return row;
    });

    // --- SHEET 5: DAFTAR KETIDAKHADIRAN (ALPHA / IZIN / SAKIT / CUTI) ---
    const dataKetidakhadiran = [];
    let noAbsenSeq = 1;

    targetKaryawanList.forEach(k => {
      const normName = (k.nama || "").trim().toLowerCase();
      const userLogs = fetchedLogs.filter(l => (l.nama || "").trim().toLowerCase() === normName);

      const presentDays = new Set(
        userLogs
          .filter(l => isMasukStatus(l.status))
          .map(l => {
            const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
            return toLocalISO(d).split("T")[0];
          })
      );

      const explicitAbsenceLogs = {};
      userLogs.forEach(l => {
        const s = (l.status || "").toUpperCase();
        if (s.includes("TIDAK MASUK") || s.includes("ALPHA") || s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI")) {
          const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
          explicitAbsenceLogs[toLocalISO(d).split("T")[0]] = l;
        }
      });

      let cur = new Date(tglMulai + "T00:00:00");
      const endD = new Date(tglSelesai + "T23:59:59");
      const todayDateOnlyStr = toLocalISO(new Date()).split("T")[0];

      while (cur <= endD) {
        const curDateStr = toLocalISO(cur).split("T")[0];
        if (cur.getDay() !== 0 && curDateStr <= todayDateOnlyStr) {
          if (!presentDays.has(curDateStr)) {
            const exp = explicitAbsenceLogs[curDateStr];
            let statusKetidakhadiran = "TIDAK MASUK (ALPHA)";
            let keterangan = "Tidak melakukan presensi masuk / dinas luar";

            if (exp) {
              const su = (exp.status || "").toUpperCase();
              if (su.includes("SAKIT")) statusKetidakhadiran = "SAKIT";
              else if (su.includes("IZIN")) statusKetidakhadiran = "IZIN";
              else if (su.includes("CUTI")) statusKetidakhadiran = "CUTI";
              else statusKetidakhadiran = "TIDAK MASUK (ALPHA)";
              keterangan = exp.keterangan || exp.status || "-";
            }

            const [yy, mm, dd] = curDateStr.split("-");
            dataKetidakhadiran.push({
              "NO": noAbsenSeq++,
              "PERUSAHAAN": getCompanyOfKaryawan(k),
              "NIK": k.nik || "-",
              "NAMA KARYAWAN": k.nama,
              "JABATAN": k.jabatan || "-",
              "DEPARTEMEN": k.dept || "-",
              "TANGGAL TIDAK MASUK": `${dd}/${mm}/${yy}`,
              "HARI": getHariIndonesia(cur),
              "STATUS KETIDAKHADIRAN": statusKetidakhadiran,
              "KETERANGAN / ALASAN": keterangan
            });
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    });

    // --- CREATE EXCEL WORKBOOK ---
    if (pText) pText.innerText = "Menyusun lembar kerja Excel...";

    const wb = XLSX.utils.book_new();

    const incSummary = customParams.includeSummary !== false;
    const incLogs = customParams.includeLogs !== false;
    const incMonthly = customParams.includeMonthly !== false;
    const incTimesheet = customParams.includeTimesheet !== false;
    const incAbsence = customParams.includeAbsence !== false;

    if (incSummary) {
      const wsSummary = XLSX.utils.json_to_sheet(dataSummary);
      XLSX.utils.book_append_sheet(wb, wsSummary, "Rekap Payroll & Kehadiran");
    }

    if (incLogs) {
      const wsLogs = XLSX.utils.json_to_sheet(dataLogs);
      XLSX.utils.book_append_sheet(wb, wsLogs, "Detail Log Absensi");
    }

    if (incMonthly && dataMonthlyBreakdown.length > 0) {
      const wsMonthly = XLSX.utils.json_to_sheet(dataMonthlyBreakdown);
      XLSX.utils.book_append_sheet(wb, wsMonthly, "Breakdown Bulanan");
    }

    if (incTimesheet && dataTimesheet.length > 0) {
      const wsTimesheet = XLSX.utils.json_to_sheet(dataTimesheet);
      XLSX.utils.book_append_sheet(wb, wsTimesheet, "Matriks Kehadiran");
    }

    if (incAbsence && dataKetidakhadiran.length > 0) {
      const wsAbsence = XLSX.utils.json_to_sheet(dataKetidakhadiran);
      XLSX.utils.book_append_sheet(wb, wsAbsence, "Daftar Ketidakhadiran");
    }

    const compLabel = (targetCompany && targetCompany !== "ALL") 
      ? targetCompany.replace(/[^a-zA-Z0-9]/g, "_") 
      : "SEMUA_PT";
    const cleanNameSuffix = searchKeyword ? `_${searchKeyword.toUpperCase().replace(/\s+/g, "_")}` : "";
    const fileName = `Laporan_Absensi_Payroll_${compLabel}${cleanNameSuffix}_${tglMulai}_sd_${tglSelesai}.xlsx`;

    XLSX.writeFile(wb, fileName);

    showLoading(false);
    if (pBox) pBox.style.display = "none";
    showToast(`Laporan Excel Berhasil Diunduh! (${fetchedLogs.length.toLocaleString("id-ID")} log dari ${tglMulai} s/d ${tglSelesai})`, "success");

    if (customParams.isFromModal) {
      tutupModalTarikanExcel();
    }
  } catch (err) {
    showLoading(false);
    if (pBox) pBox.style.display = "none";
    console.error("Tarikan Excel Error:", err);
    alert("Gagal melakukan tarikan Excel: " + err.message);
  }
}

function exportData() {
  jalankanTarikanExcel();
}

// --- FUNGSI CETAK LAPORAN REKAPITULASI PRESENSI, KETIDAKHADIRAN & PAYROLL (PRINT / PDF) ---
async function cetakLaporanRekapitulasi(customParams = {}) {
  const now = new Date();
  const year = now.getFullYear();
  const todayStr = toLocalISO(now).split("T")[0];

  const tglMulai = customParams.tglMulai ||
    (document.getElementById("modalExportExcel")?.style.display === "flex" ? document.getElementById("modalExpTglMulai")?.value : null) ||
    document.getElementById("filterTglMulai")?.value ||
    document.getElementById("logFilterTglMulai")?.value ||
    `${year}-01-01`;

  const tglSelesai = customParams.tglSelesai ||
    (document.getElementById("modalExportExcel")?.style.display === "flex" ? document.getElementById("modalExpTglSelesai")?.value : null) ||
    document.getElementById("filterTglSelesai")?.value ||
    document.getElementById("logFilterTglSelesai")?.value ||
    todayStr;

  let targetCompany = customParams.company ||
    (document.getElementById("modalExportExcel")?.style.display === "flex" ? document.getElementById("modalExpCompany")?.value : null) ||
    document.getElementById("selectActiveCompany")?.value ||
    ACTIVE_COMPANY || "ALL";

  if (ADMIN_USER?.company_access && ADMIN_USER.company_access !== "ALL") {
    targetCompany = ADMIN_USER.company_access;
  }

  showLoading("Menyiapkan dokumen cetak...");
  try {
    // Tarik data fresh dari server untuk rentang periode terpilih
    const todayStrFull = toLocalISO(new Date()).split('T')[0];
    const tglSelesaiEfektif = tglSelesai < todayStrFull ? todayStrFull : tglSelesai;
    const fetchedLogs = await fetchAllLogsInRange(tglMulai, tglSelesaiEfektif);

    let targetKar = KARYAWAN;
    if (targetCompany && targetCompany !== "ALL") {
      targetKar = targetKar.filter(k => getCompanyOfKaryawan(k) === targetCompany);
    }

    if (!targetKar || targetKar.length === 0) {
      showLoading(false);
      return alert("Tidak ada data karyawan untuk dicetak!");
    }

    const totalHariKerja = hitungHariKerjaEfektif(tglMulai, tglSelesai);
    const todayDateOnlyStr = toLocalISO(new Date()).split("T")[0];

    let totalBiayaGapok = 0;
    let totalBiayaLembur = 0;
    let totalBiayaIncentive = 0;
    let totalBiayaPotongan = 0;
    let totalBiayaTHP = 0;
    let grandTotalHadir = 0;
    let grandTotalAlpha = 0;
    let grandTotalJamLembur = 0;

    const dataRows = [];
    const detailKetidakhadiran = [];
    let noAbsenSeq = 1;

    targetKar.forEach((k, idx) => {
      const d = hitungDetailGaji(k.gaji || 0, k.nama, tglMulai, tglSelesai, fetchedLogs);
      const hariTidakMasuk = Math.max(0, totalHariKerja - (d.hadir || 0));

      totalBiayaGapok += (d.gapok || 0);
      totalBiayaLembur += (d.uangLembur || 0);
      totalBiayaIncentive += (d.incentive || 0);
      totalBiayaPotongan += (d.totalPotongan || d.pinjaman || 0);
      totalBiayaTHP += (d.thp || 0);
      grandTotalHadir += (d.hadir || 0);
      grandTotalAlpha += hariTidakMasuk;
      grandTotalJamLembur += (parseFloat(d.totalLembur) || 0);

      dataRows.push({
        no: idx + 1,
        nama: k.nama,
        nik: k.nik || "-",
        perusahaan: getCompanyOfKaryawan(k),
        jabatan: k.jabatan || k.dept || "-",
        dept: k.dept || "-",
        hadir: d.hadir || 0,
        tidakMasuk: hariTidakMasuk,
        telat: d.telat || 0,
        totalLembur: d.totalLembur || "0.0",
        uangLembur: d.uangLembur || 0,
        gapok: d.gapok || 0,
        incentive: d.incentive || 0,
        potongan: d.totalPotongan || d.pinjaman || 0,
        thp: d.thp || 0
      });

      // Rincian Ketidakhadiran Riil
      const normName = (k.nama || "").trim().toLowerCase();
      const userLogs = fetchedLogs.filter(l => (l.nama || "").trim().toLowerCase() === normName);

      const presentDays = new Set(
        userLogs
          .filter(l => isMasukStatus(l.status))
          .map(l => {
            const dt = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
            return toLocalISO(dt).split("T")[0];
          })
      );

      const explicitAbsenceLogs = {};
      userLogs.forEach(l => {
        const s = (l.status || "").toUpperCase();
        if (s.includes("TIDAK MASUK") || s.includes("ALPHA") || s.includes("IZIN") || s.includes("SAKIT") || s.includes("CUTI")) {
          const dt = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
          explicitAbsenceLogs[toLocalISO(dt).split("T")[0]] = l;
        }
      });

      let cur = new Date(tglMulai + "T00:00:00");
      const endD = new Date(tglSelesai + "T23:59:59");
      while (cur <= endD) {
        const curDateStr = toLocalISO(cur).split("T")[0];
        if (cur.getDay() !== 0 && curDateStr <= todayDateOnlyStr) {
          if (!presentDays.has(curDateStr)) {
            const exp = explicitAbsenceLogs[curDateStr];
            let statusBadge = "ALPHA";
            let statusClass = "badge-alpha";
            let ket = "Tidak melakukan presensi masuk / dinas luar";

            if (exp) {
              const su = (exp.status || "").toUpperCase();
              if (su.includes("SAKIT")) { statusBadge = "SAKIT"; statusClass = "badge-sakit"; }
              else if (su.includes("IZIN")) { statusBadge = "IZIN"; statusClass = "badge-izin"; }
              else if (su.includes("CUTI")) { statusBadge = "CUTI"; statusClass = "badge-cuti"; }
              ket = exp.keterangan || exp.status || "-";
            }

            const [yy, mm, dd] = curDateStr.split("-");
            detailKetidakhadiran.push({
              no: noAbsenSeq++,
              nama: k.nama,
              nik: k.nik || "-",
              perusahaan: getCompanyOfKaryawan(k),
              dept: k.dept || "-",
              tanggal: `${dd}/${mm}/${yy}`,
              hari: getHariIndonesia(cur),
              status: statusBadge,
              statusClass,
              keterangan: ket
            });
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    });

    const avgKehadiran = (targetKar.length * totalHariKerja) > 0
      ? ((grandTotalHadir / (targetKar.length * totalHariKerja)) * 100).toFixed(1)
      : "0";

    const compTitle = (targetCompany && targetCompany !== "ALL")
      ? targetCompany.toUpperCase()
      : "HOLDING (SELURUH PERUSAHAAN)";

    const fmtTgl = (t) => t ? t.split("-").reverse().join("/") : "-";
    const tanggalCetakStr = new Date().toLocaleDateString("id-ID", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });

    // Template Cetak Landscape A4 Resmi
    const printHtml = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Laporan Rekapitulasi Presensi & Payroll - ${compTitle}</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 12mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #0f172a;
      background: #f8fafc;
      font-size: 11px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #0f172a;
      color: white;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    @media print {
      .print-toolbar { display: none !important; }
      body { background: white; padding: 0; font-size: 10px; }
      .sheet-container { box-shadow: none !important; border: none !important; padding: 0 !important; max-width: 100% !important; margin: 0 !important; }
      .page-break { page-break-before: always; }
      tr { page-break-inside: avoid; }
    }
    .sheet-container {
      max-width: 1140px;
      margin: 20px auto;
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      border: 1px solid #e2e8f0;
    }
    .header-kop {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      border-bottom: 2.5px solid #0f172a;
      margin-bottom: 18px;
    }
    .brand-section {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-section img {
      width: 50px;
      height: 50px;
      border-radius: 10px;
      object-fit: contain;
    }
    .doc-title h1 {
      font-size: 16px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.3px;
      text-transform: uppercase;
    }
    .doc-title p {
      font-size: 11px;
      color: #475569;
      font-weight: 600;
      margin-top: 2px;
    }
    .meta-box {
      text-align: right;
      font-size: 10.5px;
      color: #334155;
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 10px;
      margin-bottom: 18px;
    }
    .summary-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      text-align: center;
    }
    .summary-card .val {
      font-size: 14px;
      font-weight: 900;
      color: #0f172a;
    }
    .summary-card .lbl {
      font-size: 9px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      margin-top: 2px;
    }
    .section-title {
      font-size: 12.5px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 10px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      vertical-align: middle;
    }
    th {
      background: #f1f5f9;
      color: #1e293b;
      font-weight: 800;
      text-transform: uppercase;
      font-size: 9px;
      letter-spacing: 0.3px;
      text-align: center;
    }
    tr:nth-child(even) { background: #fafafa; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 700; }
    .badge-alpha {
      background: #fee2e2;
      color: #b91c1c;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 8.5px;
      display: inline-block;
    }
    .badge-izin {
      background: #e0f2fe;
      color: #0369a1;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 8.5px;
      display: inline-block;
    }
    .badge-sakit {
      background: #fef3c7;
      color: #b45309;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 8.5px;
      display: inline-block;
    }
    .badge-cuti {
      background: #e0e7ff;
      color: #4338ca;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 8.5px;
      display: inline-block;
    }
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 30px;
      margin-top: 30px;
      page-break-inside: avoid;
    }
    .sign-box {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
      background: #fafafa;
    }
    .sign-box .role {
      font-size: 9.5px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      margin-bottom: 50px;
    }
    .sign-box .name {
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
      border-top: 1px dashed #94a3b8;
      padding-top: 4px;
      display: inline-block;
      min-width: 140px;
    }
    .btn-action {
      background: #10b981;
      color: white;
      border: none;
      padding: 7px 16px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-action:hover { background: #059669; }
    .btn-close {
      background: rgba(255,255,255,0.15);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 7px 14px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-close:hover { background: rgba(255,255,255,0.3); }
  </style>
</head>
<body>
  <div class="print-toolbar">
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="font-size:14px; font-weight:800;">KOBOI HRIS - Pratinjau Dokumen Cetak</span>
      <span style="font-size:11px; opacity:0.8;">| Periode: ${fmtTgl(tglMulai)} s/d ${fmtTgl(tglSelesai)}</span>
    </div>
    <div style="display:flex; gap:10px;">
      <button class="btn-action" onclick="window.print()">🖨️ Cetak / Print Sekarang</button>
      <button class="btn-close" onclick="window.close()">✕ Tutup</button>
    </div>
  </div>

  <div class="sheet-container">
    <!-- KOP LAPORAN -->
    <div class="header-kop">
      <div class="brand-section">
        <img src="logokoboi.png" alt="Logo Perusahaan" onerror="this.style.display='none'">
        <div class="doc-title">
          <h1>Laporan Rekapitulasi Presensi, Ketidakhadiran & Payroll</h1>
          <p>${compTitle}</p>
        </div>
      </div>
      <div class="meta-box">
        <div><strong>Periode:</strong> ${fmtTgl(tglMulai)} s/d ${fmtTgl(tglSelesai)} (${totalHariKerja} Hari Kerja)</div>
        <div><strong>Dicetak Pada:</strong> ${tanggalCetakStr}</div>
        <div><strong>Dicetak Oleh:</strong> ${escapeHtml(ADMIN_USER?.nama || "Admin HRD")}</div>
      </div>
    </div>

    <!-- SUMMARY METRICS -->
    <div class="summary-cards">
      <div class="summary-card">
        <div class="val">${targetKar.length} Orang</div>
        <div class="lbl">Total Karyawan</div>
      </div>
      <div class="summary-card">
        <div class="val">${totalHariKerja} Hari</div>
        <div class="lbl">Hari Kerja Efektif</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:#059669;">${avgKehadiran}%</div>
        <div class="lbl">Tingkat Hadir</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:#dc2626;">${grandTotalAlpha} Hari</div>
        <div class="lbl">Total Tidak Masuk</div>
      </div>
      <div class="summary-card">
        <div class="val">${grandTotalJamLembur.toFixed(1)} Jam</div>
        <div class="lbl">Total Jam Lembur</div>
      </div>
      <div class="summary-card">
        <div class="val" style="color:#4f46e5;">Rp ${Math.floor(totalBiayaTHP).toLocaleString('id-ID')}</div>
        <div class="lbl">Total Payroll (THP)</div>
      </div>
    </div>

    <!-- TABEL 1: REKAPITULASI PAYROLL & KEHADIRAN -->
    <div class="section-title">
      <span>1. Rekapitulasi Kehadiran & Payroll Karyawan</span>
      <span style="font-size:10px; font-weight:600; color:#64748b;">Total: ${dataRows.length} Karyawan</span>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width: 25px;">No</th>
          <th>Nama Karyawan</th>
          <th>ID / NIK</th>
          <th>Perusahaan</th>
          <th>Jabatan</th>
          <th>Hadir</th>
          <th>Tidak Masuk</th>
          <th>Telat</th>
          <th>Lembur</th>
          <th>Gaji Pokok</th>
          <th>Uang Lembur</th>
          <th>Insentif</th>
          <th>Potongan</th>
          <th>Gaji Bersih (THP)</th>
        </tr>
      </thead>
      <tbody>
        ${dataRows.map(r => `
          <tr>
            <td class="text-center">${r.no}</td>
            <td class="font-bold">${escapeHtml(r.nama)}</td>
            <td class="text-center">${escapeHtml(r.nik)}</td>
            <td style="font-size:8.5px;">${escapeHtml(r.perusahaan)}</td>
            <td>${escapeHtml(r.jabatan)}</td>
            <td class="text-center font-bold" style="color:#059669;">${r.hadir}</td>
            <td class="text-center font-bold" style="${r.tidakMasuk > 0 ? 'color:#dc2626; background:#fee2e2;' : 'color:#64748b;'}">${r.tidakMasuk}</td>
            <td class="text-center" style="${r.telat > 0 ? 'color:#d97706;' : ''}">${r.telat}</td>
            <td class="text-center">${r.totalLembur} Jam</td>
            <td class="text-right">Rp ${Math.floor(r.gapok).toLocaleString('id-ID')}</td>
            <td class="text-right">Rp ${Math.floor(r.uangLembur).toLocaleString('id-ID')}</td>
            <td class="text-right">Rp ${Math.floor(r.incentive).toLocaleString('id-ID')}</td>
            <td class="text-right">Rp ${Math.floor(r.potongan).toLocaleString('id-ID')}</td>
            <td class="text-right font-bold" style="color:#059669; font-size:10.5px;">Rp ${Math.floor(r.thp).toLocaleString('id-ID')}</td>
          </tr>
        `).join('')}
        <tr style="background:#f1f5f9; font-weight:900;">
          <td colspan="5" class="text-center" style="font-weight:900; letter-spacing:0.5px;">TOTAL KESELURUHAN</td>
          <td class="text-center" style="color:#059669;">${grandTotalHadir}</td>
          <td class="text-center" style="color:#dc2626;">${grandTotalAlpha}</td>
          <td class="text-center">-</td>
          <td class="text-center">${grandTotalJamLembur.toFixed(1)} Jam</td>
          <td class="text-right">Rp ${Math.floor(totalBiayaGapok).toLocaleString('id-ID')}</td>
          <td class="text-right">Rp ${Math.floor(totalBiayaLembur).toLocaleString('id-ID')}</td>
          <td class="text-right">Rp ${Math.floor(totalBiayaIncentive).toLocaleString('id-ID')}</td>
          <td class="text-right">Rp ${Math.floor(totalBiayaPotongan).toLocaleString('id-ID')}</td>
          <td class="text-right" style="color:#059669; font-size:11px;">Rp ${Math.floor(totalBiayaTHP).toLocaleString('id-ID')}</td>
        </tr>
      </tbody>
    </table>

    <!-- TABEL 2: DETAIL DAFTAR TIDAK MASUK (KETIDAKHADIRAN) -->
    <div class="section-title page-break" style="margin-top: 25px;">
      <span>2. Rincian Karyawan Tidak Masuk (Daftar Ketidakhadiran Riil)</span>
      <span style="font-size:10px; font-weight:600; color:#dc2626;">Total: ${detailKetidakhadiran.length} Kejadian Tidak Masuk</span>
    </div>
    ${detailKetidakhadiran.length === 0 ? `
      <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:15px; text-align:center; color:#15803d; font-weight:700; margin-bottom:20px;">
        🎉 Seluruh karyawan tercatat hadir lengkap pada periode ini (0 Ketidakhadiran).
      </div>
    ` : `
      <table>
        <thead>
          <tr>
            <th style="width: 25px;">No</th>
            <th>Tanggal</th>
            <th>Hari</th>
            <th>Nama Karyawan</th>
            <th>ID / NIK</th>
            <th>Perusahaan</th>
            <th>Departemen</th>
            <th>Status Ketidakhadiran</th>
            <th>Alasan / Keterangan</th>
          </tr>
        </thead>
        <tbody>
          ${detailKetidakhadiran.map(ktd => `
            <tr>
              <td class="text-center">${ktd.no}</td>
              <td class="text-center font-bold">${ktd.tanggal}</td>
              <td class="text-center">${ktd.hari}</td>
              <td class="font-bold">${escapeHtml(ktd.nama)}</td>
              <td class="text-center">${escapeHtml(ktd.nik)}</td>
              <td>${escapeHtml(ktd.perusahaan)}</td>
              <td>${escapeHtml(ktd.dept)}</td>
              <td class="text-center"><span class="${ktd.statusClass}">${ktd.status}</span></td>
              <td style="color:#475569;">${escapeHtml(ktd.keterangan)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}

    <!-- LEMBAR PENGESAHAN / TANDA TANGAN -->
    <div class="signatures">
      <div class="sign-box">
        <div class="role">Dibuat Oleh (HRD / Presensi)</div>
        <div class="name">${escapeHtml(ADMIN_USER?.nama || "Admin HRD")}</div>
      </div>
      <div class="sign-box">
        <div class="role">Diperiksa Oleh (Finance & Payroll)</div>
        <div class="name">Admin Finance</div>
      </div>
      <div class="sign-box">
        <div class="role">Disetujui Oleh (Direksi / CEO)</div>
        <div class="name">Direktur Utama</div>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('load', () => {
      setTimeout(() => { window.print(); }, 400);
    });
  </script>
</body>
</html>`;

    showLoading(false);
    const win = window.open('', '_blank');
    if (!win) {
      alert("Popup browser diblokir. Izinkan popup browser untuk membuka pratinjau cetak laporan.");
      return;
    }
    win.document.write(printHtml);
    win.document.close();
  } catch (err) {
    showLoading(false);
    console.error("Gagal mencetak laporan:", err);
    alert("Gagal mencetak laporan: " + err.message);
  }
}

async function hapusSemuaLog() {
  const konfirmasi = prompt("PERINGATAN: Ini akan menghapus SELURUH data absensi! Ketik 'KONFIRMASI' untuk melanjutkan:");
  if (konfirmasi !== "KONFIRMASI") return;

  showLoading(true);
  const { error } = await supabaseClient.from("logs").delete().neq("id", 0);
  if (!error) {
    showToast("Seluruh log berhasil dihapus", "success");
    syncData();
  }
  showLoading(false);
}

async function hapusSatuLog(id) {
  if (confirm("Hapus?")) {
    const { error } = await supabaseClient.from("logs").delete().eq("id", id);
    if (!error) syncData();
  }
}

function exportMasterKaryawan() {
  const targetKaryawan = getFilteredKaryawan();
  if (targetKaryawan.length === 0) return alert("Belum ada data karyawan!");

  const dataExcel = targetKaryawan.map(k => ({
    "PERUSAHAAN": getCompanyOfKaryawan(k),
    "NIK": k.nik || "-",
    "NAMA LENGKAP": k.nama,
    "FOTO": k.foto_url || "-",
    "NIK KTP": k.nik_ktp || "-",
    "DEPARTMENT": k.dept,
    "JABATAN": k.jabatan || "-",
    "WHATSAPP": k.nomor_wa || "-",
    "GAJI POKOK": k.gaji,
    "NO. REKENING": k.rekening || "-",
    "STATUS PTKP": k.status_ptkp || "-",
    "NPWP": k.npwp || "-",
    "SISA CUTI": k.sisa_cuti || 0,
    "SALDO PINJAMAN": k.pinjaman || 0,
    "PIN ABSENSI": k.pin || "-"
  }));

  const ws = XLSX.utils.json_to_sheet(dataExcel);

  // Jadikan kolom FOTO hyperlink yang bisa langsung diklik untuk lihat gambarnya
  const fotoColIndex = Object.keys(dataExcel[0] || {}).indexOf("FOTO");
  if (fotoColIndex >= 0) {
    targetKaryawan.forEach((k, i) => {
      if (k.foto_url) {
        const cellRef = XLSX.utils.encode_cell({ r: i + 1, c: fotoColIndex });
        if (ws[cellRef]) ws[cellRef].l = { Target: k.foto_url };
      }
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Master Data Karyawan");

  const compSuffix = (ACTIVE_COMPANY && ACTIVE_COMPANY !== "ALL") ? `_${ACTIVE_COMPANY.replace(/[^a-zA-Z0-9]/g, '_')}` : "";
  const fileName = `Master_Data_Karyawan${compSuffix}_${new Date().toLocaleDateString("id-ID").replace(/\//g, "-")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function setPeriodeIni() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  document.getElementById("filterTglMulai").value = firstDay.toISOString().split('T')[0];
  document.getElementById("filterTglSelesai").value = lastDay.toISOString().split('T')[0];
  syncData();
}

function setPeriodeSemingguTerakhir() {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(now.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);

  document.getElementById("filterTglMulai").value = startDate.toISOString().split('T')[0];
  document.getElementById("filterTglSelesai").value = endDate.toISOString().split('T')[0];
}

function setPeriodeLog(mode = 'ini') {
  const now = new Date();
  const year = now.getFullYear();
  let startStr = "";
  let endStr = "";

  if (mode === "hari_ini") {
    // Hari ini saja
    startStr = toLocalISO(now).split("T")[0];
    endStr = startStr;
  } else if (mode === "ytd" || mode === "jan") {
    // 1 Januari tahun berjalan s/d hari ini
    startStr = `${year}-01-01`;
    endStr = toLocalISO(now).split("T")[0];
  } else if (mode === "lalu") {
    // Bulan lalu
    const firstDay = new Date(year, now.getMonth() - 1, 1);
    const lastDay = new Date(year, now.getMonth(), 0);
    startStr = toLocalISO(firstDay).split("T")[0];
    endStr = toLocalISO(lastDay).split("T")[0];
  } else if (mode === "full" || mode === "tahun") {
    // 1 Tahun Penuh (01 Jan s/d 31 Des)
    startStr = `${year}-01-01`;
    endStr = `${year}-12-31`;
  } else if (!isNaN(mode) && Number(mode) >= 1 && Number(mode) <= 12) {
    const m = parseInt(mode, 10);
    const firstDay = new Date(year, m - 1, 1);
    const lastDay = new Date(year, m, 0);
    startStr = `${year}-${String(m).padStart(2, "0")}-01`;
    endStr = `${year}-${String(m).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
  } else {
    // Bulan ini
    const firstDay = new Date(year, now.getMonth(), 1);
    const lastDay = new Date(year, now.getMonth() + 1, 0);
    startStr = toLocalISO(firstDay).split("T")[0];
    endStr = toLocalISO(lastDay).split("T")[0];
  }

  const logMulai = document.getElementById("logFilterTglMulai");
  const logSelesai = document.getElementById("logFilterTglSelesai");
  if (logMulai) logMulai.value = startStr;
  if (logSelesai) logSelesai.value = endStr;

  const expMulai = document.getElementById("exportTglMulai");
  const expSelesai = document.getElementById("exportTglSelesai");
  if (expMulai) expMulai.value = startStr;
  if (expSelesai) expSelesai.value = endStr;

  syncData();
}

window.onload = async () => {
  if (!checkAdminAuthOrRedirect()) return;
  await applyModuleVisibility();
  await fetchHolidays();

  if (typeof syncData === 'function') {
    await syncData();
    // Pastikan tab yang aktif di sidebar ditampilkan kontennya
    const activeLink = document.querySelector(".nav-link.active");
    if (activeLink) {
      const onclickAttr = activeLink.getAttribute("onclick");
      if (onclickAttr && onclickAttr.includes("switchTab")) {
        const tabId = onclickAttr.match(/'([^']+)'/)[1];
        switchTab(tabId);
      }
    } else {
      switchTab('tabDashboard');
    }
  }
};

async function downloadUserManualWord() {
  const content = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>User Manual KOBOI</title>
    <style>
      body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; padding: 20px; }
      h1 { color: #4f46e5; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; }
      h2 { color: #1e293b; margin-top: 25px; border-left: 5px solid #4f46e5; padding-left: 10px; }
      h3 { color: #475569; }
      .feature-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; margin: 10px 0; border-radius: 8px; }
      ul { margin-bottom: 15px; }
      li { margin-bottom: 5px; }
      .tip { color: #059669; font-weight: bold; background: #ecfdf5; padding: 10px; border-radius: 5px; }
    </style>
    </head>
    <body>
      <h1>BUKU PANDUAN PENGGUNAAN SISTEM HRIS - KOBOI</h1>
      <p>Dokumen ini berisi panduan operasional untuk sistem manajemen SDM PT. Kola Borasi Indonesia.</p>

      <h2>1. Modul Dashboard & Analitik</h2>
      <div class="feature-box">
        <h3>Statistik & Grafik</h3>
        <p>Dashboard menampilkan ringkasan Manpower, Kehadiran, dan Kedisiplinan secara real-time. Gunakan grafik untuk melihat tren 7 hari terakhir.</p>
        <h3>Tabel KPI Performa</h3>
        <p>Menampilkan nilai kehadiran dan keterlambatan per individu. Gunakan <b>Filter Tanggal</b> untuk menentukan periode laporan sebelum menekan <b>Download Report (PDF)</b>.</p>
      </div>

      <h2>2. Modul Kelola Karyawan (Payroll)</h2>
      <div class="feature-box">
        <h3>Master Data</h3>
        <p>Gunakan tombol <b>Tambah Karyawan</b> untuk mendaftarkan staf baru lengkap dengan detail gaji dan rekening bank.</p>
        <h3>Perhitungan Gaji (THP)</h3>
        <p>Sistem menghitung Take Home Pay secara otomatis. Pastikan filter tanggal sudah benar sebelum mengirimkan notifikasi ke CEO atau mengunduh data Excel.</p>
      </div>

      <h2>3. Modul CEO Access</h2>
      <p>Modul untuk pimpinan menyetujui insentif. Klik <b>Approve</b> pada karyawan terkait untuk memvalidasi bonus mereka.</p>

      <h2>4. Pemeliharaan Data</h2>
      <p>Log Absensi dapat dibersihkan secara berkala menggunakan fitur <b>Hapus Semua Log</b> di tab Log Absensi.</p>

      <p class="tip">Tips: Selalu lakukan sinkronisasi data dengan menekan Refresh jika data terbaru belum muncul.</p>
      <br>
      <p style="font-size: 0.8rem; color: #94a3b8;">Generated by KOBOI HRIS System</p>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', content], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'User_Manual_KOBOI.doc';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof showToast === 'function') showToast("Buku Panduan Berhasil Diunduh", "success");
}

function toggleSidebar() {
  document.getElementById("mainSidebar").classList.toggle("active");
  const overlay = document.querySelector(".sidebar-overlay");
  if (overlay) overlay.classList.toggle("active");
}

async function cetakSemuaSlipJPG() {
  const targetKaryawan = getFilteredKaryawan();
  if (targetKaryawan.length === 0) {
    if (typeof showToast === 'function') showToast("Tidak ada data karyawan.", "error");
    return;
  }
  if (typeof html2canvas === "undefined") {
    if (typeof showToast === 'function') showToast("Library html2canvas belum siap.", "error");
    return;
  }

  showLoading("Memproses Slip JPG Semua Karyawan...");

  const tglMulai = document.getElementById("filterTglMulai")?.value;
  const tglSelesai = document.getElementById("filterTglSelesai")?.value;
  const fmt = (d) => d ? d.split('-').reverse().join('/') : '-';
  const fmtFile = (d) => d ? d.split('-').join('') : 'Current';
  const periodeTampil = (tglMulai && tglSelesai) ? `${fmt(tglMulai)} - ${fmt(tglSelesai)}` : "Bulan Berjalan";

  const renderContainer = document.createElement("div");
  renderContainer.style.position = "absolute";
  renderContainer.style.top = "-9999px";
  renderContainer.style.left = "-9999px";
  renderContainer.style.width = "800px";
  renderContainer.style.backgroundColor = "white";
  document.body.appendChild(renderContainer);

  try {
    for (let i = 0; i < targetKaryawan.length; i++) {
      const k = targetKaryawan[i];
      const d = hitungDetailGaji(k.gaji, k.nama);
      const branding = getCompanyBranding(k);

      const slipHtml = `
        <div style="font-family: 'Outfit', sans-serif; color: #1e293b; background: white; padding: 40px; border: 1px solid #e2e8f0; position: relative;">
          <div style="position: absolute; top: 20px; right: -35px; background: #fee2e2; color: #ef4444; padding: 5px 40px; transform: rotate(45deg); font-size: 0.6rem; font-weight: 800; letter-spacing: 1px;">CONFIDENTIAL</div>
          
          <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #1e293b; padding-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 15px;">
              <img src="${branding.logo}" alt="Logo" style="width: 50px; border-radius: 8px;">
              <div>
                <h1 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 4px;">${branding.name}</h1>
                <p style="font-size: 0.75rem; color: #64748b;">${branding.address}</p>
              </div>
            </div>
            <div style="text-align: right;">
              <h2 style="font-size: 1.4rem; font-weight: 800; color: #4f46e5; margin-bottom: 4px;">SLIP GAJI</h2>
              <p style="font-size: 0.85rem; font-weight: 600; color: #64748b;">Periode: ${periodeTampil}</p>
            </div>
          </header>

          <section style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;"><span style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">ID Karyawan</span><span style="font-weight: 700;">${k.id || '-'}</span></div>
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;"><span style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Nama Lengkap</span><span style="font-weight: 700;">${k.nama}</span></div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;"><span style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Jabatan / Dept</span><span style="font-weight: 700;">${k.jabatan || k.dept || '-'}</span></div>
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;"><span style="color: #64748b; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;">Hadir / Hari Kerja</span><span style="font-weight: 700;">${d.hadir} / ${d.totalHariKerja} Hari</span></div>
            </div>
          </section>

          <section style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px;">
            <div>
              <h3 style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; margin-bottom: 12px; color: #4f46e5;">Penerimaan (Earnings)</h3>
              <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span style="color: #64748b;">GAJI POKOK</span><span style="font-weight: 600;">Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}</span></div>
              <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span style="color: #64748b;">HKE (${d.hadir} hari)</span><span style="font-weight: 600;">Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}</span></div>
              <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span style="color: #64748b;">INCENTIVE</span><span style="font-weight: 600;">Rp ${Math.floor(d.incentive || 0).toLocaleString('id-ID')}</span></div>
              <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span style="color: #64748b;">INCENTIVE (LK/NGINAP)</span><span style="font-weight: 600;">Rp ${Math.floor(d.incentiveLuar || 0).toLocaleString('id-ID')}</span></div>
              <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span style="color: #64748b;">OVERTIME (${d.totalLembur} jam @ Rp ${d.tarifLembur.toLocaleString('id-ID')})</span><span style="font-weight: 600;">Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}</span></div>
            </div>
            <div>
              <h3 style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; margin-bottom: 12px; color: #4f46e5;">Potongan (Deductions)</h3>
              <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span style="color: #64748b;">PINJAMAN KANTOR</span><span style="font-weight: 600;">Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}</span></div>
              <div style="margin-top: 15px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 0.8rem;">
                  <span style="font-weight: 800; color: #64748b;">TOTAL POTONGAN</span>
                  <span style="font-weight: 600;">Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}</span>
              </div>
            </div>
          </section>

          <section style="background: #1e293b; color: white; padding: 20px 30px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.75rem; font-weight: 600; opacity: 0.7;">Total THP</span>
              <span style="font-size: 1.75rem; font-weight: 800;">Rp ${Math.floor(d.thp).toLocaleString('id-ID')}</span>
            </div>
            <div style="text-align: right; font-size: 0.75rem; font-style: italic; opacity: 0.8; max-width: 250px;">
              "Semoga bermanfaat untuk keluarga. Terus berkarya bersama ${branding.name}."
            </div>
          </section>

          <footer style="display: flex; justify-content: space-between; margin-top: 40px;">
            <div style="text-align: center; width: 180px;">
              <p style="font-size: 0.7rem; font-weight: 700; color: #64748b; margin-bottom: 60px; text-transform: uppercase;">Diterima Oleh,</p>
              <p style="font-size: 0.85rem; font-weight: 800; border-bottom: 1.5px solid #1e293b; padding-bottom: 3px;">${k.nama}</p>
              <p style="font-size: 0.65rem; color: #64748b; margin-top: 4px;">Karyawan</p>
            </div>
            <div style="text-align: center; width: 180px;">
              <p style="font-size: 0.7rem; font-weight: 700; color: #64748b; margin-bottom: 60px; text-transform: uppercase;">Disetujui Oleh,</p>
              <p style="font-size: 0.85rem; font-weight: 800; border-bottom: 1.5px solid #1e293b; padding-bottom: 3px;">Manajemen</p>
              <p style="font-size: 0.65rem; color: #64748b; margin-top: 4px;">${branding.name}</p>
            </div>
          </footer>
        </div>
      `;

      renderContainer.innerHTML = slipHtml;

      // Beri sedikit waktu agar browser sempat merender DOM
      await new Promise(r => setTimeout(r, i === 0 ? 300 : 50));

      const canvas = await html2canvas(renderContainer, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const link = document.createElement("a");
      link.download = `Slip_Gaji_${k.nama.replace(/\s+/g, '_')}_${fmtFile(tglMulai)}.jpg`;
      link.href = imgData;
      link.click();

      // Jeda antrean agar browser tidak membeku (freeze)
      await new Promise(r => setTimeout(r, 400));
    }

    if (typeof showToast === 'function') showToast("Berhasil mencetak slip JPG untuk semua karyawan.", "success");
  } catch (err) {
    console.error("Error generating JPGs:", err);
    if (typeof showToast === 'function') showToast("Gagal mencetak slip JPG.", "error");
  } finally {
    document.body.removeChild(renderContainer);
    hideLoading();
  }
}

// --- MANAJEMEN CUTI (ADMIN) ---
async function fetchLeaveRequests() {
  const { data: leaves, error } = await supabaseClient
    .from("leave_requests")
    .select("*, karyawan(id, nama, nik, sisa_cuti, perusahaan)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    const body = document.getElementById("adminLeaveBody");
    if (body && error.code === 'PGRST205') {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--danger);"><b>Error:</b> Tabel "leave_requests" tidak ditemukan di Supabase. Mohon jalankan SQL script untuk membuat tabel ini.</td></tr>';
    }
    return;
  }

  const allowedEmpIds = (ACTIVE_COMPANY && ACTIVE_COMPANY !== "ALL")
    ? new Set(getFilteredKaryawan().map(k => String(k.id)))
    : null;

  const filteredLeaves = allowedEmpIds
    ? (leaves || []).filter(lv => allowedEmpIds.has(String(lv.employee_id)))
    : (leaves || []);

  const body = document.getElementById("adminLeaveBody");
  let html = "";
  for (const lv of filteredLeaves) {
    const statusClass = lv.status === "APPROVED" ? "badge-success" : (lv.status === "REJECTED" ? "badge-danger" : "badge-warning");
    const actions = lv.status === "PENDING" ? `
            <button class="btn btn-primary btn-small" onclick="processLeave('${lv.id}', 'APPROVED', '${lv.employee_id}')">Setujui</button>
            <button class="btn btn-danger btn-small" onclick="processLeave('${lv.id}', 'REJECTED', '${lv.employee_id}')">Tolak</button>
        ` : (lv.status === "REJECTED" && lv.rejection_reason ? `<span style="font-size:0.8em; color:var(--text-muted);">Alasan: ${escapeHtml(lv.rejection_reason)}</span>` : "-");

    let lampiranHtml = "-";
    if (lv.attachment_url) {
      const { data: signed } = await supabaseClient.storage.from("leave-attachments").createSignedUrl(lv.attachment_url, 3600);
      if (signed?.signedUrl) lampiranHtml = `<a href="${signed.signedUrl}" target="_blank" rel="noopener">Lihat</a>`;
    }

    html += `
            <tr>
                <td><strong>${escapeHtml(lv.karyawan?.nama || "-")}</strong></td>
                <td>${escapeHtml(lv.type)}</td>
                <td>${lv.start_date} s/d ${lv.end_date}</td>
                <td>${escapeHtml(lv.reason)}</td>
                <td>${lampiranHtml}</td>
                <td><span class="badge ${statusClass}">${lv.status}</span></td>
                <td>${actions}</td>
            </tr>
        `;
  }
  body.innerHTML = html;
}

async function processLeave(requestId, status, employeeId) {
  let rejectionReason = null;
  if (status === "REJECTED") {
    rejectionReason = window.prompt("Alasan penolakan (akan dikirim ke karyawan via WA):");
    if (rejectionReason === null) return; // batal
  } else if (!confirm(`Konfirmasi ${status} pengajuan cuti ini?`)) {
    return;
  }

  showLoading(true);
  try {
    const updatePayload = { status };
    if (status === "REJECTED") updatePayload.rejection_reason = rejectionReason || null;

    const { error } = await supabaseClient
      .from("leave_requests")
      .update(updatePayload)
      .eq("id", requestId);

    if (error) throw error;

    if (status === "APPROVED") {
      // Ambil data cuti untuk tahu durasi (selisih hari)
      const { data: lvData } = await supabaseClient.from("leave_requests").select("start_date, end_date").eq("id", requestId).single();

      let duration = 1;
      if (lvData && lvData.start_date && lvData.end_date) {
        const d1 = new Date(lvData.start_date);
        const d2 = new Date(lvData.end_date);
        duration = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
      }

      const { data: emp } = await supabaseClient.from("karyawan").select("sisa_cuti").eq("id", employeeId).single();
      const newBalance = (emp.sisa_cuti || 0) - duration;
      await supabaseClient.from("karyawan").update({ sisa_cuti: newBalance > 0 ? newBalance : 0 }).eq("id", employeeId);
    }

    // Notifikasi WA ke karyawan - kalau gagal, jangan gagalkan keputusan yang sudah tersimpan.
    try {
      await supabaseClient.functions.invoke("send-leave-notification", {
        body: { leaveRequestId: requestId, event: status === "APPROVED" ? "approved" : "rejected" },
      });
    } catch (notifErr) {
      console.warn("Gagal kirim notifikasi WA:", notifErr);
    }

    showToast(`Cuti berhasil di-${status.toLowerCase()}`, "success");
    logAudit(`Cuti ${status}`, `leave_requests.id=${requestId}${rejectionReason ? ` - ${rejectionReason}` : ""}`);
    fetchLeaveRequests();
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    showLoading(false);
  }
}

// --- PENILAIAN PERFORMA (ADMIN) ---
function showReviewModal() {
  const sel = document.getElementById("revKaryawan");
  const targetKaryawan = getFilteredKaryawan();
  sel.innerHTML = targetKaryawan.map(k => `<option value="${k.id}">${k.nama}</option>`).join("");

  // Trigger metrik update saat ganti karyawan
  sel.onchange = () => updateKpiMetrics();

  document.getElementById("modalReview").style.display = "flex";
  updateKpiMetrics();
}

function updateKpiMetrics() {
  const empId = document.getElementById("revKaryawan").value;
  // Gunakan == agar ID string "62" cocok dengan ID number 62
  const emp = KARYAWAN.find(k => k.id == empId);
  if (!emp) return;

  const dept = (emp.dept || "DEFAULT").toUpperCase();
  const pos = (emp.jabatan || "DEFAULT").toUpperCase();
  const metrics = KPI_LIBRARY[dept]?.[pos] || KPI_LIBRARY[dept]?.["DEFAULT"] || KPI_LIBRARY["DEFAULT"];

  const container = document.getElementById("revKpiContainer");
  if (!container) return;

  container.style.display = "block";
  container.innerHTML = `
    <h4 style="font-size:0.75rem; color:#4f46e5; margin-bottom:12px; font-weight:800; text-transform:uppercase;">
        📌 Indikator KPI: ${dept} - ${pos}
    </h4>
  `;

  metrics.forEach(m => {
    container.innerHTML += `
      <div class="form-group" style="margin-bottom:10px;">
        <label style="font-size:0.7rem; color:#64748b; font-weight:600; display:block; margin-bottom:4px;">${m} (0-100)</label>
        <input type="number" class="form-input kpi-metric-input" data-metric="${m}" value="0" min="0" max="100" style="padding:6px;">
      </div>
    `;
  });
}

function closeReviewModal() {
  document.getElementById("modalReview").style.display = "none";
}

async function saveReview() {
  const empId = document.getElementById("revKaryawan").value;
  // Pakai == (bukan ===): revKaryawan.value selalu string dari DOM, sedangkan
  // karyawan.id numerik - perbandingan ketat sebelumnya selalu gagal cocok,
  // membuat "Simpan Penilaian" gagal diam-diam (emp jadi undefined).
  const emp = KARYAWAN.find(k => k.id == empId);

  // Hitung Real Attendance Score untuk periode ini
  const attendanceData = hitungDetailGaji(emp.gaji, emp.nama);
  const realAttendanceScore = (attendanceData.hadir / attendanceData.totalHariKerja) * 100;

  // Hitung rata-rata dari metrik yang diinput
  const metricInputs = document.querySelectorAll(".kpi-metric-input");
  let totalKpi = 0;
  metricInputs.forEach(input => totalKpi += parseFloat(input.value) || 0);
  const finalKpiScore = metricInputs.length > 0 ? (totalKpi / metricInputs.length) : 0;

  const review = {
    employee_id: empId,
    period: document.getElementById("revPeriod").value,
    kpi_score: finalKpiScore,
    okr_score: parseFloat(document.getElementById("revOkr").value) || 0,
    notes: document.getElementById("revNotes").value,
    attendance_score: Math.round(realAttendanceScore > 100 ? 100 : realAttendanceScore),
  };

  const avg = (review.kpi_score + review.okr_score + review.attendance_score) / 3;
  review.final_grade = avg >= 85 ? "A" : (avg >= 70 ? "B" : "C");

  showLoading(true);
  try {
    const { error } = await supabaseClient.from("performance_reviews").insert([review]);
    if (error) throw error;

    showToast("Penilaian Berhasil Disimpan", "success");
    closeReviewModal();
    fetchReviews();
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    showLoading(false);
  }
}

// KPI Otomatis: baca snapshot terakhir (harian/mingguan/bulanan) dari
// kpi_snapshots, yang diisi cron compute-kpi-snapshots. Kalau periode
// terbaru belum pernah dihitung cron (mis. baru di-deploy), tampilkan pesan
// info bukannya kosong tanpa penjelasan.
async function loadKpiRollup(periodType) {
  ["Daily", "Weekly", "Monthly"].forEach((p) => {
    const btn = document.getElementById(`btnKpi${p}`);
    if (btn) btn.classList.toggle("btn-primary", p.toLowerCase() === periodType);
  });

  const summaryEl = document.getElementById("kpiRollupSummary");
  const bodyEl = document.getElementById("kpiRollupBody");
  if (!summaryEl || !bodyEl) return;

  const { data: latestRow } = await supabaseClient
    .from("kpi_snapshots")
    .select("period_start")
    .eq("period_type", periodType)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) {
    summaryEl.innerHTML = `<div style="grid-column: 1/-1; padding: 20px; color: var(--text-muted);">Belum ada data KPI ${periodType} - akan otomatis terisi setelah jadwal cron pertama jalan.</div>`;
    bodyEl.innerHTML = "";
    return;
  }

  const { data: snapshots } = await supabaseClient
    .from("kpi_snapshots")
    .select("*, karyawan(id, nama)")
    .eq("period_type", periodType)
    .eq("period_start", latestRow.period_start)
    .order("final_score", { ascending: false });

  const allowedEmpIds = (ACTIVE_COMPANY && ACTIVE_COMPANY !== "ALL")
    ? new Set(getFilteredKaryawan().map(k => String(k.id)))
    : null;

  const rows = allowedEmpIds
    ? (snapshots || []).filter(r => allowedEmpIds.has(String(r.employee_id)))
    : (snapshots || []);

  const avgScore = rows.length ? rows.reduce((sum, r) => sum + Number(r.final_score), 0) / rows.length : 0;
  const gradeCount = { A: 0, B: 0, C: 0 };
  rows.forEach((r) => { gradeCount[r.final_grade] = (gradeCount[r.final_grade] || 0) + 1; });

  const perDept = {};
  rows.forEach((r) => {
    const d = r.dept || "LAINNYA";
    if (!perDept[d]) perDept[d] = { total: 0, count: 0 };
    perDept[d].total += Number(r.final_score);
    perDept[d].count += 1;
  });
  const deptRanking = Object.entries(perDept)
    .map(([dept, v]) => ({ dept, avg: v.total / v.count }))
    .sort((a, b) => b.avg - a.avg);

  summaryEl.innerHTML = `
    <div style="background:#f8fafc; border-radius:12px; padding:16px; text-align:center;">
      <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Periode</div>
      <div style="font-size:1rem; font-weight:800; color:var(--sidebar-bg);">${latestRow.period_start}</div>
    </div>
    <div style="background:#f8fafc; border-radius:12px; padding:16px; text-align:center;">
      <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Rata-rata Skor</div>
      <div style="font-size:1.5rem; font-weight:800; color:var(--primary);">${avgScore.toFixed(1)}</div>
    </div>
    <div style="background:#f8fafc; border-radius:12px; padding:16px; text-align:center;">
      <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Distribusi Grade</div>
      <div style="font-size:1rem; font-weight:800;"><span style="color:#10b981;">A:${gradeCount.A||0}</span> &nbsp;<span style="color:#f59e0b;">B:${gradeCount.B||0}</span> &nbsp;<span style="color:#ef4444;">C:${gradeCount.C||0}</span></div>
    </div>
    <div style="background:#f8fafc; border-radius:12px; padding:16px; text-align:center;">
      <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Dept Terbaik</div>
      <div style="font-size:1rem; font-weight:800; color:var(--sidebar-bg);">${deptRanking[0] ? `${deptRanking[0].dept} (${deptRanking[0].avg.toFixed(1)})` : "-"}</div>
    </div>
  `;

  bodyEl.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.karyawan?.nama || "-"}</td>
      <td>${r.dept || "-"} / ${r.jabatan || "-"}</td>
      <td>${r.hadir}</td>
      <td>${r.telat}</td>
      <td style="font-weight:800;">${Number(r.final_score).toFixed(1)}</td>
      <td><span style="font-weight:800; color:${r.final_grade === 'A' ? '#10b981' : r.final_grade === 'B' ? '#f59e0b' : '#ef4444'};">${r.final_grade}</span></td>
    </tr>
  `).join("");
}

async function fetchReviews() {
  const { data: reviews, error } = await supabaseClient
    .from("performance_reviews")
    .select("*, karyawan(id, nama)")
    .order("id", { ascending: false });

  if (error) return;

  const allowedEmpIds = (ACTIVE_COMPANY && ACTIVE_COMPANY !== "ALL")
    ? new Set(getFilteredKaryawan().map(k => String(k.id)))
    : null;

  const filteredReviews = allowedEmpIds
    ? (reviews || []).filter(r => allowedEmpIds.has(String(r.employee_id)))
    : (reviews || []);

  const body = document.getElementById("adminPerformanceBody");
  body.innerHTML = filteredReviews.map(r => `
        <tr>
            <td>${r.karyawan?.nama || "-"}</td>
            <td>${r.period}</td>
            <td>${r.attendance_score}</td>
            <td>${r.kpi_score}</td>
            <td>${r.okr_score}</td>
            <td><span class="badge badge-success">${r.final_grade}</span></td>
            <td><button class="btn btn-outline btn-small" onclick="deleteReview('${r.id}')"><i data-lucide="trash"></i></button></td>
        </tr>
    `).join("");
  // Attach event listener for dynamic KPI metrics.
  // Pakai onchange (bukan addEventListener) - fetchReviews() dipanggil ulang
  // tiap kali tab Performa dibuka, addEventListener akan menumpuk listener
  // baru terus setiap kali (bocor memori + updateKpiMetrics jalan berkali-kali
  // per satu perubahan). Assignment ke .onchange otomatis menggantikan yang lama.
  const revKaryawan = document.getElementById("revKaryawan");
  if (revKaryawan) {
    revKaryawan.onchange = () => updateKpiMetrics();
    // Trigger once to show metrics for the first selected employee
    updateKpiMetrics();
  }

  lucide.createIcons();
}

async function deleteReview(id) {
  if (!confirm("Hapus penilaian ini?")) return;
  await supabaseClient.from("performance_reviews").delete().eq("id", id);
  fetchReviews();
}

// --- AI WEEKLY REPORT LOGIC ---
async function generateAIWeeklyReport() {
  const modal = document.getElementById("modalAIReport");
  const content = document.getElementById("aiReportContent");

  if (!modal || !content) return;

  modal.style.display = "flex";
  content.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px;">
            <div class="spinner"></div>
            <p style="margin-top: 20px; font-weight: 600; color: #6366f1;">AI sedang menganalisis data gaji mingguan...</p>
        </div>
    `;

  // 1. Collect Data from UI & Current State
  let reportData = [];
  KARYAWAN.forEach(k => {
    const d = hitungDetailGaji(k.gaji, k.nama);
    reportData.push({
      nama: k.nama,
      dept: k.dept,
      hadir: d.hadir,
      lembur_jam: d.totalLembur, // hitungDetailGaji tidak punya field "jamLembur" - dulu selalu undefined
      gaji_bersih: d.thp
    });
  });

  const totalCost = reportData.reduce((acc, curr) => acc + curr.gaji_bersih, 0);

  // 2. Prepare Prompt for Gemini
  const prompt = `
        Anda adalah Analis HR Senior AI untuk PT. Kola Borasi Indonesia (KOBOI).
        Data Penggajian Mingguan: ${JSON.stringify(reportData)}
        Total Biaya: Rp ${totalCost.toLocaleString('id-ID')}
        
        Tugas: Buat laporan eksekutif tajam dalam Bahasa Indonesia.
        Format:
        ### 📊 RINGKASAN EKSEKUTIF
        (Status umum biaya & efisiensi)
        
        ### 💰 ANALISIS BIAYA & TOP EARNERS
        (Sebutkan 3 orang dengan gaji tertinggi dan alasannya)
        
        ### ⚠️ ANALISIS LEMBUR & RISIKO
        (Identifikasi siapa yang lembur berlebihan dan dampaknya)
        
        ### 💡 REKOMENDASI MANAJEMEN
        (3 poin tindakan konkret)
    `;

  // 3. Panggil Gemini lewat Edge Function (API key disimpan server-side,
  // tidak lagi hardcoded di kode client seperti sebelumnya).
  try {
    const { data: aiRes, error: aiErr } = await supabaseClient.functions.invoke("generate-ai-report", {
      body: { prompt },
    });
    if (aiErr) throw new Error(aiErr.message || "Gagal memanggil layanan AI");
    if (aiRes?.error) throw new Error(aiRes.error);

    let aiMarkdown = aiRes.text;

    // Simple Markdown to HTML Conversion
    const htmlContent = aiMarkdown
      .replace(/### (.*)/g, '<h4 style="color:#4f46e5; margin-top:20px; font-weight:800; border-bottom: 2px solid #eef2ff; padding-bottom:5px;">$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#1e293b;">$1</strong>')
      .replace(/\n/g, '<br>');

    content.innerHTML = `
            <div id="printableAIReport" style="background: white; padding: 40px; border-radius: 15px; border: 1px solid #e2e8f0; box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.05); max-width: 700px; margin: 0 auto; text-align: left;">
                <!-- Header Laporan (Hanya Muncul di PDF/Tampilan Rapi) -->
                <div style="text-align: center; border-bottom: 2px solid #1e293b; padding-bottom: 20px; margin-bottom: 30px;">
                    <h2 style="margin: 0; color: #1e293b; font-weight: 800; font-size: 1.5rem;">LAPORAN ANALISIS PENGGAJIAN MINGGUAN</h2>
                    <h3 style="margin: 5px 0; color: #4f46e5; font-weight: 700; font-size: 1.1rem;">PT. KOLA BORASI INDONESIA (KOBOI)</h3>
                    <p style="margin: 0; font-size: 0.8rem; color: #64748b;">Dicetak otomatis oleh KOBOI AI Enterprise pada: ${new Date().toLocaleString('id-ID')}</p>
                </div>

                <div style="color: #1e293b; font-size: 0.95rem;">
                    ${htmlContent}
                </div>

                <div style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 0.75rem; color: #94a3b8;">
                    <span>Dokumen ini bersifat rahasia (CONFIDENTIAL)</span>
                    <span>Halaman 1 dari 1</span>
                </div>
            </div>
        `;
    lucide.createIcons();
  } catch (e) {
    console.error("AI Error:", e);
    content.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <i data-lucide="x-circle" style="width: 48px; height: 48px; color: #ef4444; margin-bottom: 20px;"></i>
                <h4 style="font-weight: 800; color: #1e293b;">AI Gagal Merespon</h4>
                <p style="color: #64748b; font-size: 0.8rem; margin-top: 10px; background: #fee2e2; padding: 10px; border-radius: 8px; font-family: monospace;">
                    Error: ${escapeHtml(e.message)}
                </p>
                <p style="margin-top: 15px; font-size: 0.75rem; color: #94a3b8;">
                    Tips: Pastikan GEMINI_API_KEY sudah di-set sebagai secret Edge Function generate-ai-report.
                </p>
            </div>
        `;
    lucide.createIcons();
  }
}

function closeAIModal() {
  document.getElementById("modalAIReport").style.display = "none";
}

function exportAIReportPDF() {
  const element = document.getElementById('printableAIReport');
  if (!element) return;

  const opt = {
    margin: [0.5, 0.5], // Margin 0.5 inch (Standar Rapih)
    filename: `KOBOI_AI_Report_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 3, // Resolusi tinggi agar teks tajam
      useCORS: true,
      letterRendering: true
    },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
  };

  // Efek Loading saat unduh
  showLoading(true);
  html2pdf().set(opt).from(element).save().then(() => {
    showLoading(false);
    showToast("Laporan A4 Berhasil Diunduh", "success");
  });
}


// --- MANUAL LOG (LUPA ABSEN / STATUS TIDAK MASUK) ---
function showManualLogModal() {
  const sel = document.getElementById("manLogNama");
  if (sel) {
    const list = getFilteredKaryawan().length > 0 ? getFilteredKaryawan() : KARYAWAN;
    sel.innerHTML = list.map(k => `<option value="${escapeHtml(k.nama)}">${escapeHtml(k.nama)} (${escapeHtml(getCompanyOfKaryawan(k))})</option>`).join("");
  }

  // Set default date & time to now
  const now = new Date();
  document.getElementById("manLogTgl").value = toLocalISO(now).split('T')[0];
  document.getElementById("manLogJam").value = now.toTimeString().split(' ')[0].substring(0, 5);
  const ketEl = document.getElementById("manLogKeterangan");
  if (ketEl) ketEl.value = "";

  document.getElementById("modalManualLog").style.display = "flex";
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeManualLogModal() {
  document.getElementById("modalManualLog").style.display = "none";
}

async function saveManualLog() {
  const nama = document.getElementById("manLogNama")?.value;
  const tgl = document.getElementById("manLogTgl")?.value;
  const jam = document.getElementById("manLogJam")?.value || "09:00";
  const status = document.getElementById("manLogStatus")?.value || "MASUK";
  const keterangan = document.getElementById("manLogKeterangan")?.value?.trim() || null;

  if (!nama || !tgl) return alert("Harap lengkapi nama dan tanggal!");

  const localDate = new Date(`${tgl}T${jam}:00`);
  const isoWaktu = toLocalISO(localDate);
  const info = KARYAWAN.find(k => k.nama === nama);

  const statusUpper = status.toUpperCase();
  let isLate = false;
  if (statusUpper.startsWith("MASUK") || statusUpper.startsWith("DINAS LUAR") || statusUpper.startsWith("BERANGKAT")) {
    const hh = localDate.getHours();
    const mm = localDate.getMinutes();
    if (hh > STANDAR_MASUK || (hh === STANDAR_MASUK && mm > TOLERANSI_MASUK_MENIT)) isLate = true;
  }

  showLoading(true);
  try {
    const { error } = await supabaseClient.from("logs").insert([{
      nama: nama,
      dept: info ? info.dept : "-",
      waktu: isoWaktu,
      status: status,
      foto: null,
      isLate: isLate,
      keterangan: keterangan
    }]);

    if (error) throw error;

    if (typeof showToast === 'function') showToast("Presensi / status manual berhasil disimpan!", "success");
    closeManualLogModal();
    const ketEl = document.getElementById("manLogKeterangan");
    if (ketEl) ketEl.value = "";
    await syncData(); // Refresh all data
  } catch (err) {
    alert("Gagal menyimpan data: " + err.message);
  } finally {
    showLoading(false);
  }
}

// --- DETEKSI LUPA ABSEN LOGIC ---
function deteksiLupaAbsen() {
  const tglMulaiStr = document.getElementById("logFilterTglMulai").value;
  const tglSelesaiStr = document.getElementById("logFilterTglSelesai").value;
  if (!tglMulaiStr || !tglSelesaiStr) return alert("Pilih periode terlebih dahulu!");

  const start = new Date(tglMulaiStr);
  const end = new Date(tglSelesaiStr);
  const body = document.getElementById("lupaAbsenBody");
  let html = "";

  // Ambil semua log yang ada di memori (sudah di-sync)
  // Kita asumsikan LOGS sudah terisi dari syncData

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue; // Skip Minggu

    const dateStr = d.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    KARYAWAN.forEach(k => {
      // Filter logs untuk karyawan ini di tanggal ini
      const logsHariIni = allLogs.filter(l => {
        const logDate = new Date(new Date(l.waktu).getTime() - 4 * 3600000).toISOString().split('T')[0];
        return l.nama === k.nama && logDate === dateStr;
      });

      const hasMasuk = logsHariIni.some(l => l.status.toUpperCase().startsWith("MASUK") || l.status.toUpperCase().startsWith("DINAS LUAR"));
      const hasPulang = logsHariIni.some(l => l.status.toUpperCase().startsWith("PULANG"));

      // Jika belum masuk (hanya cek jika tanggal sudah lewat atau sudah siang)
      if (!hasMasuk) {
        html += `
          <tr>
            <td><strong>${k.nama}</strong></td>
            <td>${dateStr}</td>
            <td><span class="badge badge-danger">Lupa Masuk</span></td>
            <td>
              <button class="btn btn-outline btn-small" onclick="kirimPengingatWA('${k.nama}', '${k.nomor_wa}', '${dateStr}', 'MASUK')">
                <i data-lucide="message-circle" style="width:14px;"></i>
              </button>
            </td>
          </tr>`;
      }

      // Jika belum pulang (hanya cek jika tanggal sudah lewat)
      if (hasMasuk && !hasPulang && dateStr < todayStr) {
        html += `
          <tr>
            <td><strong>${k.nama}</strong></td>
            <td>${dateStr}</td>
            <td><span class="badge badge-warning">Lupa Pulang</span></td>
            <td>
              <button class="btn btn-outline btn-small" onclick="kirimPengingatWA('${k.nama}', '${k.nomor_wa}', '${dateStr}', 'PULANG')">
                <i data-lucide="message-circle" style="width:14px;"></i>
              </button>
            </td>
          </tr>`;
      }
    });
  }

  body.innerHTML = html || "<tr><td colspan='4' style='text-align:center;'>Semua presensi lengkap!</td></tr>";
  document.getElementById("modalLupaAbsen").style.display = "flex";
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeLupaAbsenModal() {
  document.getElementById("modalLupaAbsen").style.display = "none";
}

function kirimPengingatWA(nama, nomor, tanggal, tipe) {
  if (!nomor) return alert("Nomor WA tidak ada!");

  let noWa = nomor.trim();
  if (noWa.startsWith("0")) noWa = "62" + noWa.slice(1);
  else if (!noWa.startsWith("62")) noWa = "62" + noWa;

  const pesan = `Halo *${nama}*,\n\nKami mendeteksi Anda belum melakukan absensi *${tipe}* pada tanggal *${tanggal}*.\n\nMohon segera konfirmasi ke Admin atau lakukan input manual jika ada kendala teknis. Terima kasih!`;

  const url = `https://wa.me/${noWa}?text=${encodeURIComponent(pesan)}`;
  window.open(url, '_blank');
}

async function cetakLaporanLupaAbsenPDF() {
  const tglMulaiStr = document.getElementById("logFilterTglMulai").value;
  const tglSelesaiStr = document.getElementById("logFilterTglSelesai").value;
  const body = document.getElementById("lupaAbsenBody");

  if (body.innerText.includes("Semua presensi lengkap")) {
    return alert("Tidak ada data untuk dicetak.");
  }

  const opt = {
    margin: 10,
    filename: `Laporan_Lupa_Absen_${tglMulaiStr}_${tglSelesaiStr}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  const content = document.createElement("div");
  content.style.padding = "20px";
  content.style.fontFamily = "Arial, sans-serif";

  const headerHtml = `
    <div style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px;">
      <h1 style="margin: 0; font-size: 18pt;">PT. KOLA BORASI INDONESIA</h1>
      <p style="margin: 5px 0; font-size: 10pt;">Laporan Deteksi Lupa Presensi (Hari Kerja)</p>
      <p style="margin: 0; font-size: 9pt; font-weight: bold;">Periode: ${tglMulaiStr} s/d ${tglSelesaiStr}</p>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 10pt;">
      <thead>
        <tr style="background: #f1f5f9;">
          <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">Nama Karyawan</th>
          <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">Tanggal</th>
          <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">Keterangan</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from(body.querySelectorAll("tr")).map(tr => {
    const cells = tr.querySelectorAll("td");
    return `
            <tr>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">${cells[0].innerText}</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">${cells[1].innerText}</td>
              <td style="border: 1px solid #cbd5e1; padding: 8px;">${cells[2].innerText}</td>
            </tr>`;
  }).join("")}
      </tbody>
    </table>
    <div style="margin-top: 30px; text-align: right; font-size: 9pt;">
      <p>Dicetak pada: ${new Date().toLocaleString('id-ID')}</p>
      <br><br><br>
      <p>( Admin HRIS )</p>
    </div>
  `;

  content.innerHTML = headerHtml;

  showLoading(true);
  try {
    await html2pdf().set(opt).from(content).save();
    showToast("Laporan PDF berhasil dibuat!", "success");
  } catch (err) {
    alert("Gagal mencetak PDF: " + err.message);
  } finally {
    showLoading(false);
  }
}

// --- KALENDER & HARI LIBUR LOGIC ---
let currentCalendarDate = new Date();
// Dulu array hardcoded di sini - sekarang dibaca dari tabel holidays
// (migration 0013) supaya jadi satu sumber data yang sama dengan yang
// dipakai kedua reminder WA (masuk 09:30 & pulang 23:00) untuk skip hari
// libur. Diisi oleh fetchHolidays(), dipanggil sekali saat halaman dimuat.
let DAFTAR_LIBUR = [];

async function fetchHolidays() {
  const { data, error } = await supabaseClient.from("holidays").select("tgl, nama").order("tgl", { ascending: true });
  if (!error) DAFTAR_LIBUR = data || [];
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const title = document.getElementById("calendarMonthTitle");
  if (!grid) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  title.innerText = `${monthNames[month]} ${year}`;

  grid.innerHTML = "";
  
  // Empty slots for start of month
  for (let i = 0; i < firstDay; i++) {
    const div = document.createElement("div");
    div.className = "calendar-day empty";
    grid.appendChild(div);
  }

  // Days
  const todayObj = new Date();
  const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSunday = dateObj.getDay() === 0;
    const isToday = dateStr === todayStr;
    const holiday = DAFTAR_LIBUR.find(h => h.tgl === dateStr);

    const div = document.createElement("div");
    div.className = `calendar-day ${isSunday ? 'sunday' : ''} ${isToday ? 'today' : ''} ${holiday ? 'holiday' : ''}`;
    
    // Hitung Kehadiran Real-time untuk tanggal ini (Gunakan allLogs)
    const hadirCount = KARYAWAN.filter(k => {
      return allLogs.some(l => {
        const lDate = new Date(l.waktu);
        const logDateStr = `${lDate.getFullYear()}-${String(lDate.getMonth() + 1).padStart(2, '0')}-${String(lDate.getDate()).padStart(2, '0')}`;
        const s = l.status.toUpperCase();
        return l.nama === k.nama && logDateStr === dateStr && (s.includes("MASUK") || s.includes("DINAS"));
      });
    }).length;

    const totalKar = KARYAWAN.length;
    const isFuture = dateStr > todayStr;
    
    let attendanceHtml = "";
    if (!isSunday && !isFuture && totalKar > 0) {
      const color = hadirCount === totalKar ? 'var(--success)' : (hadirCount > 0 ? 'var(--warning)' : '#94a3b8');
      attendanceHtml = `<div class="attendance-mini-badge" style="color: ${color};">${hadirCount}/${totalKar}</div>`;
    }

    div.innerHTML = `
      <span style="z-index:1;">${d}</span>
      ${attendanceHtml}
    `;
    
    if (holiday) div.title = holiday.nama;
    grid.appendChild(div);
  }

  renderHolidaysList(month);
}

function renderHolidaysList(month) {
  const list = document.getElementById("holidaysList");
  const monthHolidays = DAFTAR_LIBUR.filter(h => new Date(h.tgl).getMonth() === month);
  
  list.innerHTML = monthHolidays.map(h => {
    const d = new Date(h.tgl).getDate();
    return `
      <div class="holiday-item">
        <div class="holiday-date-badge">${d}</div>
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--sidebar-bg);">${h.nama}</div>
      </div>
    `;
  }).join("") || "<p style='font-size:0.8rem; color:var(--text-muted); text-align:center;'>Tidak ada hari libur bulan ini.</p>";
}

function changeCalendarMonth(offset) {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + offset);
  renderCalendar();
}

// Tambahkan inisialisasi di syncData atau switchTab
// Saya akan memodifikasi switchTab untuk memicu renderCalendar

// --- REALTIME CLOCK LOGIC ---
function updateClock() {
  const now = new Date();
  const timeEl = document.getElementById("liveClockTime");
  const dateEl = document.getElementById("liveClockDate");
  
  if (timeEl) {
    timeEl.innerText = now.toLocaleTimeString('id-ID', { hour12: false });
  }
  
  if (dateEl) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.innerText = now.toLocaleDateString('id-ID', options);
  }
}

// Update clock every second
setInterval(updateClock, 1000);
updateClock(); // Initial call

// --- SUPABASE REALTIME SUBSCRIPTION ---
function initRealtime() {
  console.log("Initializing Supabase Realtime...");
  
  supabaseClient
    .channel('any')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' }, payload => {
      console.log('New log detected:', payload.new);
      // Jika ada log baru, otomatis sinkronkan data agar dashboard update
      syncData(); 
      if (typeof showToast === 'function') showToast("Presensi baru masuk: " + payload.new.nama, "info");
    })
    .subscribe();
}

// Panggil initRealtime saat aplikasi siap
document.addEventListener("DOMContentLoaded", () => {
  initRealtime();
});
