/**
 * KOBOI ESS PORTAL - LOGIC
 * Handles personal employee actions: Payslips, Leave Requests, and Performance.
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";

// Token login (diterbitkan oleh Edge Function login-employee) dilampirkan
// otomatis ke tiap request Supabase lewat callback accessToken ini - inilah
// yang dibaca RLS di database untuk menentukan data siapa yang boleh diakses.
const supabaseClient = supabase.createClient(SB_URL, SB_KEY, {
  accessToken: async () => localStorage.getItem("hris_token") || null,
});

let CURRENT_USER = null;
let MY_LOGS = [];
let ALL_KARYAWAN = []; // Needed for slip calculations

// --- AUTHENTICATION ---
async function loginEmployee() {
  const nik = document.getElementById("loginNik").value.trim().toUpperCase();
  const pin = document.getElementById("loginPin").value.trim();
  const errEl = document.getElementById("loginError");

  if (!nik || !pin) return (errEl.innerText = "Harap isi NIK dan PIN!");

  showLoading(true);
  try {
    const res = await fetch(`${SB_URL}/functions/v1/login-employee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nik, pin }),
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || "NIK atau PIN salah!");

    localStorage.setItem("hris_token", result.token);

    // Ambil data lengkap karyawan (slip gaji, dsb butuh semua kolom) memakai
    // token yang baru saja terbit - sekaligus jadi tes token-nya benar jalan.
    const { data, error } = await supabaseClient.from("karyawan").select("*").eq("id", result.user.id).single();
    if (error || !data) throw new Error("Gagal memuat profil karyawan.");

    CURRENT_USER = data;
    localStorage.setItem("hris_user", JSON.stringify(data));
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("portalContainer").style.display = "flex";

    initPortal();
  } catch (err) {
    errEl.innerText = err.message;
    localStorage.removeItem("hris_token");
    localStorage.removeItem("hris_user");
  } finally {
    showLoading(false);
  }
}

function logout() {
  localStorage.removeItem("hris_token");
  localStorage.removeItem("hris_user");
  window.location.reload();
}

// Lanjutkan sesi otomatis kalau token masih ada & belum kedaluwarsa (memperbaiki
// bug lama: sesi karyawan sebelumnya hilang setiap kali halaman di-refresh).
function tryResumeSession() {
  const token = localStorage.getItem("hris_token");
  const cachedUser = localStorage.getItem("hris_user");
  if (!token || !cachedUser) return;

  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (!claims.exp || claims.exp * 1000 < Date.now() || claims.app_role !== "user") {
      localStorage.removeItem("hris_token");
      localStorage.removeItem("hris_user");
      return;
    }
    CURRENT_USER = JSON.parse(cachedUser);
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("portalContainer").style.display = "flex";
    initPortal();
  } catch {
    localStorage.removeItem("hris_token");
    localStorage.removeItem("hris_user");
  }
}

document.addEventListener("DOMContentLoaded", tryResumeSession);

// --- PORTAL INITIALIZATION ---
async function initPortal() {
  document.getElementById("welcomeMsg").innerText = `Selamat Datang, ${CURRENT_USER.nama}`;
  document.getElementById("userDept").innerText = `Departemen: ${CURRENT_USER.dept} | ID: ${CURRENT_USER.nik}`;
  document.getElementById("statLeave").innerText = CURRENT_USER.sisa_cuti || 0;

  await syncData();
  renderDashboard();
  lucide.createIcons();
}

async function syncData() {
  // Fetch logs for current user
  const { data: logs } = await supabaseClient
    .from("logs")
    .select("*")
    .eq("nama", CURRENT_USER.nama)
    .order("id", { ascending: false });
  MY_LOGS = logs || [];

  // Fetch all employees (needed for some global calcs in hitungDetailGaji)
  const { data: allK } = await supabaseClient.from("karyawan").select("*");
  ALL_KARYAWAN = allK || [];
}

// --- UI NAVIGATION ---
// Terima `evt` sebagai parameter eksplisit (bukan bergantung pada variabel
// global implicit `window.event`) - supaya tetap jalan kalau suatu saat
// dipanggil bukan langsung dari atribut onclick (mis. lewat keyboard shortcut
// atau tryResumeSession), yang tidak punya event bawaan.
function switchTab(tabId, evt) {
  const tabs = document.querySelectorAll(".tab-content");
  tabs.forEach(t => t.style.display = "none");
  document.getElementById(tabId).style.display = "block";

  const links = document.querySelectorAll(".nav-link");
  links.forEach(l => l.classList.remove("active"));
  if (evt?.currentTarget) evt.currentTarget.classList.add("active");

  if (tabId === "tabLeave") renderLeaveHistory();
  if (tabId === "tabPerformance") { renderPerformance(); renderKpiSnapshotCard(); }
  lucide.createIcons();
}

// --- DASHBOARD ---
function renderDashboard() {
  const body = document.getElementById("attendanceBody");
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthLogs = MY_LOGS.filter(l => {
    const d = new Date(l.waktu);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const hadirCount = [...new Set(
    monthLogs
      .filter(l => {
        const s = l.status.toUpperCase();
        return s.startsWith('MASUK') || s.startsWith('BERANGKAT') || s.startsWith('DINAS LUAR');
      })
      .map(l => {
        const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
        const pad = num => (num < 10 ? '0' : '') + num;
        return d.getDay() !== 0 ? (d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())) : null;
      })
      .filter(d => d !== null)
  )].length;
  // "DINAS LUAR" juga terhitung telat kalau isLate, sama seperti "MASUK"
  // (lihat script.js prosesAbsen) - sebelumnya karyawan yang telat lewat
  // Dinas Luar tidak pernah tercatat telat di statistik pribadinya.
  const lateCount = monthLogs.filter(l => {
    const s = (l.status || "").toUpperCase();
    return (s.startsWith("MASUK") || s.startsWith("DINAS LUAR")) && l.isLate;
  }).length;

  document.getElementById("statHadir").innerText = hadirCount;
  document.getElementById("statLate").innerText = lateCount;

  // CALCULATE LIVE KPI
  const liveKpi = calculateLiveKPI(hadirCount, lateCount);
  const kpiValEl = document.getElementById("statKpiVal");
  const kpiBadgeEl = document.getElementById("kpiGradeBadge");
  
  if (kpiValEl) {
    kpiValEl.innerText = liveKpi.score.toFixed(1);
    kpiValEl.style.color = liveKpi.color;
  }
  if (kpiBadgeEl) {
    kpiBadgeEl.innerText = liveKpi.grade;
    kpiBadgeEl.style.color = liveKpi.color;
    kpiBadgeEl.style.background = `${liveKpi.color}22`; // Add transparency
  }

  let html = "";
  MY_LOGS.slice(0, 10).forEach(l => {
    const tgl = new Date(l.waktu);
    html += `
      <tr>
        <td>${tgl.toLocaleDateString('id-ID')}</td>
        <td>${tgl.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
        <td><span class="badge ${l.status === 'MASUK' ? 'badge-success' : 'badge-warning'}">${l.status}</span></td>
        <td>${l.isLate ? '<span style="color:red">Terlambat</span>' : 'Tepat Waktu'}</td>
      </tr>
    `;
  });
  body.innerHTML = html;
}

// --- LEAVE MANAGEMENT ---
async function submitLeave() {
  const type = document.getElementById("leaveType").value;
  const start = document.getElementById("leaveStart").value;
  const end = document.getElementById("leaveEnd").value;
  const reason = document.getElementById("leaveReason").value;

  if (!start || !end || !reason) return alert("Harap isi semua data pengajuan!");

  showLoading(true);
  try {
    const { error } = await supabaseClient.from("leave_requests").insert([{
      employee_id: CURRENT_USER.id,
      type: type,
      start_date: start,
      end_date: end,
      reason: reason,
      status: "PENDING"
    }]);

    if (error) throw error;
    alert("Pengajuan cuti berhasil dikirim! Menunggu persetujuan HR.");
    document.getElementById("leaveReason").value = "";
    renderLeaveHistory();
  } catch (err) {
    alert("Gagal: " + err.message);
  } finally {
    showLoading(false);
  }
}

async function renderLeaveHistory() {
  const body = document.getElementById("leaveHistoryBody");
  const { data: leaves } = await supabaseClient
    .from("leave_requests")
    .select("*")
    .eq("employee_id", CURRENT_USER.id)
    .order("id", { ascending: false });

  let html = "";
  (leaves || []).forEach(lv => {
    const statusClass = lv.status === "APPROVED" ? "badge-success" : (lv.status === "REJECTED" ? "badge-danger" : "badge-warning");
    html += `
      <tr>
        <td>${lv.type}</td>
        <td>${lv.start_date} s/d ${lv.end_date}</td>
        <td><span class="badge ${statusClass}">${lv.status}</span></td>
      </tr>
    `;
  });
  body.innerHTML = html || "<tr><td colspan='3'>Belum ada riwayat.</td></tr>";
}

function getPayslipHtml() {
  const m = document.getElementById("slipMonth").value;
  const y = document.getElementById("slipYear").value;
  if (m === "") return null;

  const lastDay = new Date(y, parseInt(m) + 1, 0);
  const pad = num => (num < 10 ? '0' : '') + num;
  const startStr = `${y}-${pad(parseInt(m)+1)}-01`;
  const endStr = `${y}-${pad(parseInt(m)+1)}-${pad(lastDay.getDate())}`;

  const d = hitungDetailGaji(CURRENT_USER.gaji, CURRENT_USER.nama, startStr, endStr);
  return createSlipHtml(CURRENT_USER, d, `${getMonthName(m)} ${y}`);
}

function previewPayslip() {
  const html = getPayslipHtml();
  if (!html) return alert("Pilih bulan terlebih dahulu!");
  
  const container = document.getElementById("payslipPreviewContainer");
  const box = document.getElementById("payslipPreviewBox");
  box.innerHTML = html;
  container.style.display = "block";
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- PAYSLIP DOWNLOAD ---
async function downloadPayslip() {
  const m = document.getElementById("slipMonth").value;
  const y = document.getElementById("slipYear").value;

  if (m === "") return alert("Pilih bulan terlebih dahulu!");

  showLoading(true);
  try {
    const slipHtml = getPayslipHtml();
    
    // Gunakan div sementara agar ukuran fix dan tidak terpotong (meski layar HP kecil)
    const element = document.createElement("div");
    element.innerHTML = slipHtml;
    element.style.position = "absolute";
    element.style.top = "-9999px";
    element.style.width = "800px"; // Paksa ukuran desktop untuk PDF
    document.body.appendChild(element);

    const opt = {
      margin: 10,
      filename: `Slip_Gaji_${CURRENT_USER.nama.replace(/\s+/g, '_')}_${getMonthName(m)}_${y}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, windowWidth: 800 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    await html2pdf().set(opt).from(element).save();
    document.body.removeChild(element);
    
  } catch (err) {
    alert("Gagal mengunduh slip: " + err.message);
  } finally {
    showLoading(false);
  }
}

// --- KPI OTOMATIS (diisi cron compute-kpi-snapshots) ---
async function renderKpiSnapshotCard() {
  const cont = document.getElementById("kpiSnapshotCard");
  if (!cont) return;

  const periods = [
    { type: "daily", label: "Hari Ini" },
    { type: "weekly", label: "Minggu Ini" },
    { type: "monthly", label: "Bulan Ini" },
  ];

  const cards = await Promise.all(periods.map(async (p) => {
    const { data } = await supabaseClient
      .from("kpi_snapshots")
      .select("final_score, final_grade, hadir, telat")
      .eq("employee_id", CURRENT_USER.id)
      .eq("period_type", p.type)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      return `<div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:16px; text-align:center;">
        <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">${p.label}</div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-top:8px;">Belum ada data</div>
      </div>`;
    }

    const color = data.final_grade === "A" ? "var(--success)" : data.final_grade === "B" ? "var(--warning)" : "var(--danger)";
    return `<div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:16px; text-align:center; border-top: 3px solid ${color};">
      <div style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">${p.label}</div>
      <div style="font-size:1.6rem; font-weight:800; color:${color};">${Number(data.final_score).toFixed(1)}</div>
      <div style="font-size:0.7rem; color:var(--text-muted);">Grade ${data.final_grade} &middot; Hadir ${data.hadir} / Telat ${data.telat}</div>
    </div>`;
  }));

  cont.innerHTML = cards.join("");
}

// --- PERFORMANCE ---
async function renderPerformance() {
  const cont = document.getElementById("performanceContent");
  const { data: reviews } = await supabaseClient
    .from("performance_reviews")
    .select("*")
    .eq("employee_id", CURRENT_USER.id)
    .order("id", { ascending: false });

  if (!reviews || reviews.length === 0) return;

  let html = "";
  reviews.forEach(r => {
    html += `
      <div class="performance-card data-section" style="margin-bottom: 24px; border-left: 4px solid ${r.final_grade === 'A' ? 'var(--success)' : (r.final_grade === 'B' ? 'var(--warning)' : 'var(--danger)')}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <div>
                <h4 style="color:var(--primary); font-size:1.1rem;">Rapor Periode: ${r.period}</h4>
                <p style="font-size:0.75rem; color:var(--text-muted);">Diterbitkan pada ${new Date(r.created_at).toLocaleDateString('id-ID')}</p>
            </div>
            <div style="text-align:right;">
                <span style="font-size:0.7rem; color:var(--text-muted); display:block; margin-bottom:4px;">GRADE AKHIR</span>
                <span class="badge" style="font-size:1.5rem; padding:12px 24px; background:${r.final_grade === 'A' ? 'var(--success)' : (r.final_grade === 'B' ? 'var(--warning)' : 'var(--danger)')}22; color:${r.final_grade === 'A' ? 'var(--success)' : (r.final_grade === 'B' ? 'var(--warning)' : 'var(--danger)')}">${r.final_grade}</span>
            </div>
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom:20px;">
            ${renderMetric("Attendance", r.attendance_score)}
            ${renderMetric("KPI (Target)", r.kpi_score)}
            ${renderMetric("OKR (Objektif)", r.okr_score)}
        </div>

        <div style="background:rgba(0,0,0,0.1); padding:15px; border-radius:12px;">
            <p style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; font-weight:800; margin-bottom:8px;">Feedback Manajer:</p>
            <p style="font-size:0.9rem; font-style:italic; line-height:1.5;">"${r.notes || 'Pertahankan performa Anda dan terus berikan yang terbaik!'}"</p>
        </div>
      </div>
    `;
  });
  cont.innerHTML = html;
}

function renderMetric(label, score) {
  const color = score >= 85 ? 'var(--success)' : (score >= 70 ? 'var(--warning)' : 'var(--danger)');
  return `
    <div>
        <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:8px;">
            <span style="color:var(--text-muted); font-weight:600;">${label}</span>
            <span style="font-weight:800; color:${color}">${score}</span>
        </div>
        <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:10px; overflow:hidden;">
            <div style="width:${score}%; height:100%; background:${color}; border-radius:10px;"></div>
        </div>
    </div>
  `;
}

// --- UTILS & HELPERS ---
function showLoading(show) {
  document.getElementById("loadingOverlay").style.display = show ? "flex" : "none";
}

function getMonthName(idx) {
  return ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][idx];
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

// Helper: hitungDetailGaji (Logic replicated from admin.js for offline calculation)
function hitungDetailGaji(gapok, namaKaryawan, customStart, customEnd) {
  const targetNama = namaKaryawan.trim().toLowerCase();
  const k = ALL_KARYAWAN.find(item => (item.nama || '').trim().toLowerCase() === targetNama);
  const totalHariKerja = 22; // Simplified fallback for ESS
  
  const g = parseFloat(gapok) || 0;
  const hkeRate = k ? (parseFloat(k.hke_rate) || 50000) : 50000;
  const incentive = k ? (k.is_incentive_approved ? (parseFloat(k.incentive_approved_val) || 0) : 0) : 0;
  const pinjaman = k ? (parseFloat(k.pinjaman) || 0) : 0;

  // Filter logs for this employee in this period
  const start = new Date(customStart + "T00:00:00");
  const end = new Date(customEnd + "T23:59:59");
  const periodLogs = MY_LOGS.filter(l => {
    const w = new Date(l.waktu);
    return w >= start && w <= end;
  });

  const hariHadir = [...new Set(
    periodLogs
      .filter(l => {
        const s = l.status.toUpperCase();
        return s.startsWith('MASUK') || s.startsWith('BERANGKAT') || s.startsWith('DINAS LUAR');
      })
      .map(l => {
        const d = new Date(new Date(l.waktu).getTime() - 4 * 3600000);
        const pad = num => (num < 10 ? '0' : '') + num;
        return d.getDay() !== 0 ? (d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())) : null;
      })
      .filter(d => d !== null)
  )].length;
  
  // Simplified Overtime for ESS View (Assuming 0 if not calculated here yet)
  const uangLembur = 0; 
  const thp = g + (hariHadir * hkeRate) + incentive - pinjaman;

  return {
    gapok: g,
    uangHKE: hariHadir * hkeRate,
    hadir: hariHadir,
    totalHariKerja,
    totalLembur: 0,
    uangLembur,
    incentive,
    pinjaman,
    thp: thp > 0 ? thp : 0
  };
}

function createSlipHtml(k, d, period) {
  return `
    <div style="font-family: 'Outfit', sans-serif; color: #1e293b; background: white; padding: 40px; border: 1px solid #e2e8f0; width: 100%; max-width: 800px; margin: 0 auto; box-sizing: border-box;">
      <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #1e293b; padding-bottom: 20px;">
        <div>
          <h1 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 4px;">PT. KOLA BORASI INDONESIA</h1>
          <p style="font-size: 0.75rem; color: #64748b;">Human Resource Information System</p>
        </div>
        <div style="text-align: right;">
          <h2 style="font-size: 1.4rem; font-weight: 800; color: #4f46e5; margin-bottom: 4px;">SLIP GAJI</h2>
          <p style="font-size: 0.85rem; font-weight: 600; color: #64748b;">Periode: ${period}</p>
        </div>
      </header>

      <section style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; background: #f8fafc; padding: 20px; border-radius: 12px;">
        <div>
          <p style="font-size: 0.7rem; color: #64748b; font-weight: 600; text-transform: uppercase;">Nama Lengkap</p>
          <p style="font-weight: 700;">${k.nama}</p>
        </div>
        <div>
          <p style="font-size: 0.7rem; color: #64748b; font-weight: 600; text-transform: uppercase;">Jabatan / Dept</p>
          <p style="font-weight: 700;">${k.jabatan || k.dept}</p>
        </div>
      </section>

      <section style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px;">
        <div>
          <h3 style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; color: #4f46e5;">Penerimaan</h3>
          <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span>Gaji Pokok</span><span style="font-weight: 600;">Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}</span></div>
          <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span>HKE (${d.hadir} hari)</span><span style="font-weight: 600;">Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}</span></div>
          <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span>Incentive</span><span style="font-weight: 600;">Rp ${Math.floor(d.incentive).toLocaleString('id-ID')}</span></div>
        </div>
        <div>
          <h3 style="font-size: 0.85rem; font-weight: 800; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; color: #4f46e5;">Potongan</h3>
          <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span>Pinjaman Kantor</span><span style="font-weight: 600;">Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}</span></div>
        </div>
      </section>

      <section style="background: #1e293b; color: white; padding: 20px 30px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="font-size: 0.75rem; font-weight: 600; opacity: 0.7;">Total Gaji Bersih (THP)</span>
          <br>
          <span style="font-size: 1.75rem; font-weight: 800;">Rp ${Math.floor(d.thp).toLocaleString('id-ID')}</span>
        </div>
      </section>
      
      <p style="margin-top: 40px; font-size: 0.7rem; color: #94a3b8; text-align: center;">Dihasilkan secara otomatis oleh KOBOI ESS PORTAL pada ${new Date().toLocaleString('id-ID')}</p>
    </div>
  `;
}
