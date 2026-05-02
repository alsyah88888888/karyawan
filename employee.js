/**
 * KOBOI ESS PORTAL - LOGIC
 * Handles personal employee actions: Payslips, Leave Requests, and Performance.
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

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
    const { data, error } = await supabaseClient
      .from("karyawan")
      .select("*")
      .eq("nik", nik)
      .eq("pin", pin)
      .single();

    if (error || !data) throw new Error("NIK atau PIN salah!");

    CURRENT_USER = data;
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("portalContainer").style.display = "flex";
    
    initPortal();
  } catch (err) {
    errEl.innerText = err.message;
  } finally {
    showLoading(false);
  }
}

function logout() {
  window.location.reload();
}

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
function switchTab(tabId) {
  const tabs = document.querySelectorAll(".tab-content");
  tabs.forEach(t => t.style.display = "none");
  document.getElementById(tabId).style.display = "block";

  const links = document.querySelectorAll(".nav-link");
  links.forEach(l => l.classList.remove("active"));
  event.currentTarget.classList.add("active");

  if (tabId === "tabLeave") renderLeaveHistory();
  if (tabId === "tabPerformance") renderPerformance();
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

  const hadirCount = [...new Set(monthLogs.map(l => new Date(l.waktu).toLocaleDateString()))].length;
  const lateCount = monthLogs.filter(l => l.status === 'MASUK' && l.isLate).length;

  document.getElementById("statHadir").innerText = hadirCount;
  document.getElementById("statLate").innerText = lateCount;

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

// --- PAYSLIP DOWNLOAD ---
async function downloadPayslip() {
  const m = document.getElementById("slipMonth").value;
  const y = document.getElementById("slipYear").value;

  if (m === "") return alert("Pilih bulan terlebih dahulu!");

  showLoading(true);
  try {
    // We need to calculate the slip for the selected month
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, parseInt(m) + 1, 0);
    const startStr = firstDay.toISOString().split('T')[0];
    const endStr = lastDay.toISOString().split('T')[0];

    // Re-use logic from admin.js for calculation
    const d = hitungDetailGaji(CURRENT_USER.gaji, CURRENT_USER.nama, startStr, endStr);
    
    // Generate the HTML for the slip
    const slipHtml = createSlipHtml(CURRENT_USER, d, `${getMonthName(m)} ${y}`);

    const element = document.createElement("div");
    element.innerHTML = slipHtml;
    document.body.appendChild(element);

    const opt = {
      margin: 10,
      filename: `Slip_Gaji_${CURRENT_USER.nama}_${getMonthName(m)}_${y}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
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
      <div class="performance-card data-section" style="margin-bottom: 20px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
            <h4 style="color:var(--primary)">Periode: ${r.period}</h4>
            <span class="badge badge-success" style="font-size:1.2rem; padding:10px 20px;">NILAI: ${r.final_grade}</span>
        </div>
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom:15px;">
            <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:12px; text-align:center;">
                <div style="font-size:0.7rem; color:var(--text-muted);">ATTENDANCE</div>
                <div style="font-size:1.2rem; font-weight:800;">${r.attendance_score}</div>
            </div>
            <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:12px; text-align:center;">
                <div style="font-size:0.7rem; color:var(--text-muted);">KPI</div>
                <div style="font-size:1.2rem; font-weight:800;">${r.kpi_score}</div>
            </div>
            <div style="background:rgba(0,0,0,0.2); padding:15px; border-radius:12px; text-align:center;">
                <div style="font-size:0.7rem; color:var(--text-muted);">OKR</div>
                <div style="font-size:1.2rem; font-weight:800;">${r.okr_score}</div>
            </div>
        </div>
        <p style="font-size:0.9rem; color:var(--text-muted); font-style:italic;">Catatan HR: "${r.notes || '-'}"</p>
      </div>
    `;
  });
  cont.innerHTML = html;
}

// --- UTILS & HELPERS ---
function showLoading(show) {
  document.getElementById("loadingOverlay").style.display = show ? "flex" : "none";
}

function getMonthName(idx) {
  return ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][idx];
}

// Helper: hitungDetailGaji (Logic replicated from admin.js for offline calculation)
function hitungDetailGaji(gapok, namaKaryawan, customStart, customEnd) {
  const targetNama = namaKaryawan.trim().toLowerCase();
  const k = ALL_KARYAWAN.find(item => item.nama.trim().toLowerCase() === targetNama);
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

  const hariHadir = [...new Set(periodLogs.map(l => new Date(l.waktu).toLocaleDateString()))].length;
  
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
    <div style="font-family: 'Outfit', sans-serif; color: #1e293b; background: white; padding: 40px; border: 1px solid #e2e8f0; width: 190mm;">
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
