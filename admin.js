/**
 * KOBOI ADMIN - PREMIUM LOGIC
 * Manages statistics, employees, attendance logs, and payroll (including Overtime).
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

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
        "ADMIN": ["Ketepatan Laporan", "Kecepatan Respon", "Kerapihan Administrasi"],
        "DEFAULT": ["Kualitas Kerja", "Inisiatif", "Kedisiplinan"]
    },
    "OPERASIONAL": {
        "DRIVER": ["Ketepatan Waktu Kirim", "Kondisi Kendaraan", "Keamanan Berkendara"],
        "HELPER": ["Kecepatan Muat/Bongkar", "Kerapihan Gudang", "Kerjasama Tim"],
        "DEFAULT": ["Kualitas Kerja", "Sikap/Attitude", "Kerjasama"]
    },
    "FINANCE": {
        "DEFAULT": ["Ketelitian Data", "Deadline Pembayaran", "Audit Compliance"]
    },
    "DEFAULT": ["Kualitas Kerja", "Sikap", "Tanggung Jawab"]
};

// Chart Instances
let punctualityChartInstance = null;
let attendanceChartInstance = null;

// --- CORE SYNC ---
async function syncData() {
  if (!document.getElementById("filterTglMulai").value) setPeriodeIni();
  if (!document.getElementById("kpiFilterTglMulai").value) setPeriodeKPI('ini');
  if (!document.getElementById("logFilterTglMulai").value) setPeriodeLog('ini');
  // Set default tab to dashboard if none active
  if (!document.querySelector(".nav-link.active")) switchTab('tabDashboard');
  
  showLoading(true);
  try {
    const { data: dataKar, error: errK } = await supabaseClient.from("karyawan").select("*").order("nama", { ascending: true });
    if (errK) throw errK;
    KARYAWAN = dataKar || [];

    const { data: dataAllLog, error: errA } = await supabaseClient.from("logs").select("id, nama, dept, waktu, status, isLate").order("id", { ascending: false });
    if (errA) throw errA;
    allLogs = dataAllLog || [];

    const { data: dataLog, error: errL } = await supabaseClient.from("logs").select("*").order("id", { ascending: false }).limit(200);
    if (errL) throw errL;
    logs = dataLog || [];

    refreshUI();
    showToast("Data berhasil disinkronkan", "success");
  } catch (e) {
    showToast("Sync Gagal: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

function refreshUI() {
  renderStats();
  renderLogTable();
  renderKaryawanTable();
  renderCEOTable();
  renderVisualStats();
  renderKPITable();
}

// --- DASHBOARD UI ---
function renderStats() {
  const manpowerEl = document.getElementById("statManpower");
  const hadirEl = document.getElementById("statHadir");
  const terlambatEl = document.getElementById("statTerlambat");
  const avgAttEl = document.getElementById("statAvgAttendance");

  if (manpowerEl) manpowerEl.innerText = KARYAWAN.length;

  const todayStr = new Date().toLocaleDateString();
  const logsToday = allLogs.filter(l => new Date(l.waktu).toLocaleDateString() === todayStr);

  const uniqueHadir = [...new Set(logsToday.filter(l => l.status === 'MASUK').map(l => l.nama))].length;
  const totalTelat = logsToday.filter(l => l.status === 'MASUK' && l.isLate).length;

  if (hadirEl) hadirEl.innerText = uniqueHadir;
  if (terlambatEl) terlambatEl.innerText = totalTelat;

  // Rata-rata Kehadiran Perusahaan Periode Ini
  let totalRate = 0;
  KARYAWAN.forEach(k => {
    const d = hitungDetailGaji(k.gaji, k.nama);
    const rate = ((d.hadir / d.totalHariKerja) * 100) || 0;
    totalRate += rate;
  });
  const avgRate = KARYAWAN.length > 0 ? (totalRate / KARYAWAN.length) : 0;
  if (avgAttEl) avgAttEl.innerText = avgRate.toFixed(1) + "%";
}

function renderVisualStats() {
  // 1. Chart Analisis Kedisiplinan (Punctuality)
  const punctCtx = document.getElementById('punctualityChart')?.getContext('2d');
  if (punctCtx) {
    const onTime = allLogs.filter(l => l.status === 'MASUK' && !l.isLate).length;
    const late = allLogs.filter(l => l.status === 'MASUK' && l.isLate).length;

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
      
      const uniqueAtDay = [...new Set(allLogs.filter(l => 
        new Date(l.waktu).toLocaleDateString() === dateStr && l.status === 'MASUK'
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
  const tabs = ["tabDashboard", "tabLog", "tabKaryawan", "tabLeave", "tabPerformance", "tabCEO"];
  tabs.forEach((t) => {
    const el = document.getElementById(t);
    if (el) el.style.display = t === tab ? "block" : "none";
  });

  // Update Sidebar Active States
  const links = ["linkTabDashboard", "linkTabLog", "linkTabKaryawan", "linkTabLeave", "linkTabPerformance", "linkTabCEO"];
  links.forEach(l => {
    const el = document.getElementById(l);
    if (el) el.classList.toggle("active", l.includes(tab.replace('tab', '')));
  });

  if (tab === "tabLeave") fetchLeaveRequests();
  if (tab === "tabPerformance") fetchReviews();

  // Sembunyikan Header Actions (Tambah/Export) jika di Dashboard atau CEO
  const headerActions = document.querySelector(".header-actions");
  if (headerActions) headerActions.style.display = (tab === "tabKaryawan") ? "flex" : "none";

  const title = document.getElementById("pageTitle");
  if (title) {
    if (tab === "tabDashboard") title.innerText = "Executive Dashboard";
    else if (tab === "tabLog") title.innerText = "Log Absensi Real-time";
    else if (tab === "tabCEO") title.innerText = "Direksi / CEO Panel";
    else title.innerText = "Manajemen Karyawan";
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
  
  // Tutup sidebar di mobile setelah klik menu
  const sidebar = document.getElementById("mainSidebar");
  if (sidebar) sidebar.classList.remove("active");
}

function renderKPITable() {
  const body = document.getElementById("kpiTableBody");
  if (!body) return;

  const customStart = document.getElementById("kpiFilterTglMulai")?.value;
  const customEnd = document.getElementById("kpiFilterTglSelesai")?.value;

  let htmlRows = "";
  KARYAWAN.forEach(k => {
    const d = hitungDetailGaji(k.gaji, k.nama, customStart, customEnd);
    
    // Perhitungan KPI
    const attendanceRate = ((d.hadir / d.totalHariKerja) * 100) || 0;
    
    let logsKar = allLogs.filter(l => l.nama.trim().toLowerCase() === k.nama.trim().toLowerCase() && l.status === 'MASUK');
    
    // Filter logs berdasarkan tanggal dashboard
    if (customStart && customEnd) {
        const start = new Date(customStart + "T00:00:00");
        const end = new Date(customEnd + "T23:59:59");
        logsKar = logsKar.filter(l => {
            const w = new Date(l.waktu);
            return w >= start && w <= end;
        });
    }
    
    const lateCount = logsKar.filter(l => l.isLate).length;

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
          <div style="font-size: 0.7rem; color: var(--text-muted);">${k.jabatan || "-"}</div>
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
  KARYAWAN.forEach((k, index) => {
    const masterInsentif = (parseFloat(k.incentive) || 0) + (parseFloat(k.incentive_luar) || 0);
    const approvedVal = parseFloat(k.incentive_approved_val) || 0;
    const isApproved = k.is_incentive_approved === true;

    htmlRows += `
      <tr>
        <td>
          <div style="font-weight: 700;">${k.nama}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${k.dept}</div>
        </td>
        <td>Rp ${masterInsentif.toLocaleString('id-ID')}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">Rp</span>
            <input type="number" id="valInsentifCEO_${index}" class="form-input" 
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
            <button class="btn btn-primary btn-small" onclick="simpanIncentiveCEO(${index})">
                Setujui Nominal
            </button>
            ${isApproved ? `<button class="btn btn-danger btn-small" onclick="batalkanIncentiveCEO(${index})">Batalkan</button>` : ''}
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
}

async function simpanIncentiveCEO(index) {
  const k = KARYAWAN[index];
  const inputVal = document.getElementById(`valInsentifCEO_${index}`).value;
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
    syncData(); // Sinkronkan data agar tabel payroll ikut update
  } else {
    alert("Gagal menyimpan: " + error.message);
  }
}

async function batalkanIncentiveCEO(index) {
  const k = KARYAWAN[index];
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
  if (!body) return;

  let htmlRows = "";
  logs.forEach((l) => {
    const sClass = l.status === "MASUK" ? "badge-success" : "badge-warning";
    const tgl = new Date(l.waktu);

    htmlRows += `
      <tr>
        <td>
          <div style="font-weight: 700; color: var(--sidebar-bg);">${l.nama}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${l.dept || "GENERAL"}</div>
        </td>
        <td><span class="badge ${sClass}">${l.status}</span></td>
        <td>
          <div style="font-weight: 600;">${tgl.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${tgl.toLocaleDateString('id-ID')}</div>
        </td>
        <td>
          ${l.isLate ? '<span style="color:var(--danger); font-size:0.75rem; font-weight:800;">⚠️ TERLAMBAT</span>' : '<span style="color:var(--success); font-size:0.75rem;">✅ TEPAT WAKTU</span>'}
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-small" onclick="bukaModalEdit(${l.id})">Edit</button>
            <button class="btn btn-danger btn-small" onclick="hapusSatuLog(${l.id})">Hapus</button>
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderKaryawanTable() {
  const body = document.getElementById("karyawanTableBody");
  if (!body) return;

  let htmlRows = "";
  KARYAWAN.forEach((k, index) => {
    const d = hitungDetailGaji(k.gaji || 0, k.nama);
    htmlRows += `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 45px; height: 45px; border-radius: 50%; overflow: hidden; border: 2px solid var(--border); background: #f1f5f9;">
              <img src="image/NAME CARD KOLA BORASI INDONESIA/${k.nik}.jpg" 
                   onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(k.nama)}&background=random'"
                   style="width: 100%; height: 100%; object-fit: cover;">
            </div>
            <div>
              <div style="font-weight: 700; color: var(--primary); font-size: 1rem;">${k.nama}</div>
              <div style="font-size: 0.7rem; color: #64748b; letter-spacing: 1px;">ID: ${k.nik}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600;">${k.jabatan || k.dept}</div>
          <div style="font-size: 0.75rem; color: #64748b;">Hadir: ${d.hadir}/${d.totalHariKerja}</div>
        </td>
        <td>
          <div style="font-weight: 700;">${d.totalLembur} Jam</div>
          <div style="font-size: 0.75rem; color: var(--success);">+ Rp ${d.uangLembur.toLocaleString("id-ID")}</div>
        </td>
        <td>
          <div style="font-weight: 700;">Rp ${(k.gaji || 0).toLocaleString("id-ID")}</div>
          <div style="font-size: 0.7rem; color: #94a3b8;">${k.rekening || "-"}</div>
        </td>
        <td style="color: var(--success); font-weight: 800; font-size: 1rem;">
          Rp ${Math.floor(d.thp).toLocaleString("id-ID")}
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-small" onclick="cetakSlip(${index})">
                <i data-lucide="printer" style="width:14px;"></i> <span>Cetak</span>
            </button>
            <button class="btn btn-primary btn-small" style="background:#25d366; border:none;" onclick="kirimSlipWA(${index})">
                <i data-lucide="message-circle" style="width:14px;"></i> <span>WhatsApp</span>
            </button>
            <button class="btn btn-outline btn-small" onclick="bukaModalEditKaryawan(${index})">
                <i data-lucide="edit-3" style="width:14px;"></i> <span>Edit</span>
            </button>
            <button class="btn btn-danger btn-small" onclick="hapusKaryawan('${k.id}')">
                <i data-lucide="trash-2" style="width:14px;"></i> <span>Hapus</span>
            </button>
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
  lucide.createIcons(); // Initialize icons in the table
}

// --- PAYROLL & OVERTIME LOGIC ---
// --- UTILS: TIMEZONE-SAFE ---
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

function hitungDetailGaji(gapok, namaKaryawan, customStart = null, customEnd = null) {
  const targetNama = namaKaryawan.trim().toLowerCase();
  const k = KARYAWAN.find(item => item.nama.trim().toLowerCase() === targetNama);

  const tglMulai = customStart || document.getElementById("filterTglMulai")?.value;
  const tglSelesai = customEnd || document.getElementById("filterTglSelesai")?.value;
  const totalHariKerja = hitungHariKerjaEfektif(tglMulai, tglSelesai);

  const g = parseFloat(gapok) || 0;
  const hkeRate = k ? (parseFloat(k.hke_rate) || 50000) : 50000;

  // Otoritas CEO Per Karyawan (Gunakan Nominal yang disetujui CEO)
  const isApproved = k ? (k.is_incentive_approved === true) : false;
  const incentive = isApproved ? (parseFloat(k.incentive_approved_val) || 0) : 0;
  const incentiveLuar = 0; // Dipusatkan ke satu nilai approved_val oleh CEO
  const pinjaman = k ? (parseFloat(k.pinjaman) || 0) : 0;

  let dataLogKaryawan = allLogs
    .filter((l) => l.nama.trim().toLowerCase() === targetNama)
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
    const d = new Date(dateObj.getTime() - 5 * 3600000);
    return d.toLocaleDateString("en-CA"); // YYYY-MM-DD format
  };
  const hariHadir = [...new Set(dataLogKaryawan.map((l) => getShiftDateStr(new Date(l.waktu))))].length;

  let totalLembur = 0;
  let i = 0;
  while (i < dataLogKaryawan.length) {
    const l = dataLogKaryawan[i];
    const statusUpper = l.status.toUpperCase();
    if (statusUpper === 'MASUK' || statusUpper === 'BERANGKAT') {
      const actualMasuk = new Date(l.waktu);
      const thresholdMasuk = getWIBThreshold(actualMasuk, STANDAR_MASUK);
      if (actualMasuk < thresholdMasuk) {
        let jamPagi = (thresholdMasuk - actualMasuk) / (1000 * 60 * 60);
        if (jamPagi > 0) totalLembur += jamPagi;
      }
      let shiftEnd = null;
      let j = i + 1;
      while (j < dataLogKaryawan.length && dataLogKaryawan[j].status.toUpperCase() === 'PULANG') {
        shiftEnd = new Date(dataLogKaryawan[j].waktu);
        j++;
      }
      if (shiftEnd) {
        const thresholdPulang = getWIBThreshold(actualMasuk, STANDAR_PULANG);
        let jamSore = (shiftEnd - thresholdPulang) / (1000 * 60 * 60);
        if (jamSore > 0) totalLembur += jamSore;
        i = j;
      } else { i++; }
    } else { i++; }
  }

  // --- LOGIKA LEMBUR (Hardcoded: Pembulatan 0.1 Jam) ---
  let uangLembur = 0;
  const adjJam = k ? (parseFloat(k.lembur_adj) || 0) : 0;
  let jamLemburFinal = totalLembur + adjJam; // Terapkan penyesuaian manual
  let jamLemburBulat = jamLemburFinal;

  // CEK APAKAH LEMBUR AKTIF UNTUK KARYAWAN INI
  const isLemburAktif = k ? (k.is_lembur !== false) : true;

  if (isLemburAktif) {
    jamLemburBulat = Math.round(jamLemburFinal * 10) / 10;
    uangLembur = jamLemburBulat * TARIF_LEMBUR;
  } else {
    uangLembur = 0;
    jamLemburBulat = 0;
  }

  // --- TOTAL SALARY ---
  const uangHKE = hariHadir * hkeRate;
  const thp = g + uangHKE + incentive + incentiveLuar + uangLembur - pinjaman;

  return {
    gapok: g,
    hkeRate,
    uangHKE,
    hadir: hariHadir,
    totalHariKerja,
    totalLembur: jamLemburBulat.toFixed(1),
    uangLembur,
    incentive,
    incentiveLuar,
    pinjaman,
    thp: thp > 0 ? thp : 0
  };
}

function cetakSlip(index) {
  const k = KARYAWAN[index];
  const d = hitungDetailGaji(k.gaji, k.nama);
  const tglMulai = document.getElementById("filterTglMulai")?.value;
  const tglSelesai = document.getElementById("filterTglSelesai")?.value;
  
  const fmt = (d) => d ? d.split('-').reverse().join('/') : '-';
  const periodeTampil = (tglMulai && tglSelesai) ? `${fmt(tglMulai)} - ${fmt(tglSelesai)}` : "Bulan Berjalan";

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
            <img src="logokoboi.png" alt="Logo KBI">
            <div class="company-name">
              <h1>PT. KOLA BORASI INDONESIA</h1>
              <p>Green Kartika Residence Blok EE No.2, Cibinong, Bogor</p>
            </div>
          </div>
          <div class="doc-title">
            <h2>PAYSLIP</h2>
            <p>${periodeTampil}</p>
          </div>
        </header>

        <section class="info-box">
          <div class="info-photo">
            <img src="image/NAME CARD KOLA BORASI INDONESIA/${k.nik}.jpg" 
                 onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(k.nama)}&background=4f46e5&color=fff'">
          </div>
          <div class="info-details">
            <div class="info-item"><span class="label">Nama Karyawan</span><span class="val">${k.nama}</span></div>
            <div class="info-item"><span class="label">NIK / ID</span><span class="val">${k.nik}</span></div>
            <div class="info-item"><span class="label">Jabatan / Dept</span><span class="val">${k.jabatan || k.dept}</span></div>
            <div class="info-item"><span class="label">No. Rekening</span><span class="val">${k.rekening || '-'}</span></div>
            <div class="info-item"><span class="label">Hadir / Hari Kerja</span><span class="val">${d.hadir} / ${d.totalHariKerja} Hari</span></div>
            <div class="info-item"><span class="label">NPWP</span><span class="val">${k.npwp || '-'}</span></div>
          </div>
        </section>

        <section class="salary-grid">
          <div class="salary-col">
            <h3>Penerimaan (Earnings)</h3>
            <div class="row"><span class="label">GAJI POKOK</span><span class="val">Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">HKE (${d.hadir} hari)</span><span class="val">Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">INCENTIVE</span><span class="val">Rp ${Math.floor(d.incentive || 0).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">INCENTIVE (LK/NGINAP)</span><span class="val">Rp ${Math.floor(d.incentiveLuar || 0).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">OVERTIME (${d.totalLembur} jam)</span><span class="val">Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}</span></div>
          </div>
          <div class="salary-col">
            <h3>Potongan (Deductions)</h3>
            <div class="row"><span class="label">PINJAMAN KANTOR</span><span class="val">Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}</span></div>
            <div class="row"><span class="label">PPh21 (Estimasi)</span><span class="val">Rp 0</span></div>
            <div class="row" style="margin-top: 15px; border-top: 1px solid var(--slate-200); padding-top: 10px;">
                <span class="label" style="font-weight: 800;">TOTAL POTONGAN</span>
                <span class="val">Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}</span>
            </div>
          </div>
        </section>

        <section class="total-section">
          <div class="total-thp">
            <span class="label">Total THP</span>
            <span class="val">Rp ${Math.floor(d.thp).toLocaleString('id-ID')}</span>
          </div>
          <div class="thp-message">
            "Semoga bermanfaat untuk keluarga. Terus berkarya bersama KOLA BORASI."
          </div>
        </section>

        <footer class="signatures">
          <div class="sign-box">
            <p class="label">Diterima Oleh,</p>
            <p class="name">${k.nama}</p>
          </div>
          <div class="sign-box">
            <p class="label">HRD Manager,</p>
            <p class="name">PT. Kola Borasi Indonesia</p>
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

function kirimSlipWA(index) {
  const k = KARYAWAN[index];
  const d = hitungDetailGaji(k.gaji, k.nama);
  const date = new Date();
  const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const period = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;

  if (!k.nomor_wa) return alert("Nomor WhatsApp tidak ditemukan!");

  // Format Pesan
  let pesan = `*SLIP GAJI - ${k.nama.toUpperCase()}*\n`;
  pesan += `Periode: ${period}\n`;
  pesan += `----------------------------------\n`;
  pesan += `GAJI POKOK: Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}\n`;
  pesan += `PINJAMAN KANTOR: Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}\n`;
  pesan += `HKE (${d.hadir} hari): Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}\n`;
  pesan += `INCENTIVE: Rp ${Math.floor(d.incentive || 0).toLocaleString('id-ID')}\n`;
  pesan += `INCENTIVE (LK/NGINAP): Rp ${Math.floor(d.incentiveLuar || 0).toLocaleString('id-ID')}\n`;
  pesan += `OVERTIME (${d.totalLembur} jam): Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}\n`;
  pesan += `----------------------------------\n`;
  pesan += `*Total THP: Rp ${Math.floor(d.thp).toLocaleString('id-ID')}*\n`;
  pesan += `----------------------------------\n`;
  pesan += `_Pesan otomatis dari Sistem HRIS KOBOI_`;

  // Format nomor (ubah 0 jadi 62)
  let noWa = k.nomor_wa.trim();
  if (noWa.startsWith("0")) noWa = "62" + noWa.slice(1);
  else if (!noWa.startsWith("62")) noWa = "62" + noWa;

  const url = `https://wa.me/${noWa}?text=${encodeURIComponent(pesan)}`;
  window.open(url, '_blank');
}

// --- UTILS & UX ---
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

  // Filter Karyawan berdasarkan Departemen
  const filteredKar = deptFilter === "ALL"
    ? KARYAWAN
    : KARYAWAN.filter(k => k.dept.toUpperCase() === deptFilter.toUpperCase());

  if (filteredKar.length === 0) return showToast(`Tidak ada data karyawan ${deptFilter} untuk periode ini.`, "info");

  filteredKar.forEach((k, index) => {
    const d = hitungDetailGaji(k.gaji, k.nama);
    const isApproved = k.is_incentive_approved === true;
    const insentifVal = isApproved ? (parseFloat(k.incentive_approved_val) || 0) : 0;

    totalTHP += d.thp;
    count++;

    rincianKaryawan += `${count}. *${k.nama}* (${k.dept})\n`;
    rincianKaryawan += `   - GAJI POKOK: Rp ${Math.floor(d.gapok).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - PINJAMAN KANTOR: Rp ${Math.floor(d.pinjaman).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - HKE (${d.hadir} hari): Rp ${Math.floor(d.uangHKE).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - INCENTIVE: Rp ${insentifVal.toLocaleString('id-ID')} ${isApproved ? '✅' : '❌'}\n`;
    rincianKaryawan += `   - INCENTIVE (LK/NGINAP): Rp ${Math.floor(d.incentiveLuarMaster).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - OVERTIME (${d.totalLembur} jam): Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}\n`;
    rincianKaryawan += `   - *Total THP: Rp ${Math.floor(d.thp).toLocaleString('id-ID')}*\n\n`;
  });

  let pesan = `*LAPORAN REKAP PAYROLL - ${deptFilter.toUpperCase()}*\n`;
  pesan += `PT. KOLA BORASI INDONESIA\n`;
  pesan += `Periode: ${periodeTampil}\n`;
  pesan += `----------------------------------\n\n`;
  pesan += `*DETAIL PER KARYAWAN:*\n`;
  pesan += rincianKaryawan;
  pesan += `----------------------------------\n`;
  pesan += `*TOTAL ESTIMASI DANA: Rp ${Math.floor(totalTHP).toLocaleString('id-ID')}*\n`;
  pesan += `----------------------------------\n`;
  pesan += `_Laporan disesuaikan dengan departemen ${deptFilter}_.\n\n`;
  pesan += `Review Detail: ${window.location.href}`;

  const url = `https://wa.me/${CEO_PHONE}?text=${encodeURIComponent(pesan)}`;
  window.open(url, '_blank');
  logAudit(`Notif CEO ${deptFilter}`, `Mengirim rekap payroll ${deptFilter} periode ${periodeTampil}`);
}
function showModal() {
  document.getElementById("modalTitle").innerText = "Tambah Karyawan (Master Data)";
  document.getElementById("editKaryawanId").value = "";
  document.getElementById("btnSimpanKaryawan").innerText = "Simpan Master Data";

  // Reset Form
  const fields = ["inpNama", "inpNikKtp", "inpWa", "inpJabatan", "inpCuti", "inpNikKbi", "inpIsLembur", "inpLemburAdj", "inpPin", "inpGaji", "inpHkeRate", "inpIncentive", "inpIncentiveLuar", "inpRekening", "inpNpwp", "inpPinjaman"];
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) {
      if (f === "inpCuti") el.value = 12;
      else if (f === "inpHkeRate") el.value = 50000;
      else if (f === "inpIsLembur") el.value = "true";
      else if (f === "inpLemburAdj" || f === "inpPinjaman" || f === "inpIncentive" || f === "inpIncentiveLuar") el.value = 0;
      else el.value = "";
    }
  });
  document.getElementById("inpDept").value = "OFFICE";
  document.getElementById("inpPtkp").value = "TK/0";

  document.getElementById("modalKaryawan").style.display = "flex";
}

function hideModal() { document.getElementById("modalKaryawan").style.display = "none"; }

async function simpanKaryawan() {
  const id = document.getElementById("editKaryawanId").value;
  const data = {
    nama: document.getElementById("inpNama").value.toUpperCase(),
    nik_ktp: document.getElementById("inpNikKtp").value,
    nomor_wa: document.getElementById("inpWa").value,
    dept: document.getElementById("inpDept").value,
    jabatan: document.getElementById("inpJabatan").value.toUpperCase(),
    sisa_cuti: parseInt(document.getElementById("inpCuti").value) || 0,
    nik: document.getElementById("inpNikKbi").value,
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
    pinjaman: parseFloat(document.getElementById("inpPinjaman").value) || 0
  };

  if (!data.nama || !data.gaji) return alert("Harap isi Nama dan Gaji Pokok!");

  showLoading(true);
  try {
    if (id) {
      const { error } = await supabaseClient.from("karyawan").update(data).eq("id", id);
      if (error) throw error;
      showToast("Data karyawan berhasil diperbarui", "success");
      logAudit("Edit Karyawan", `Mengubah data karyawan: ${data.nama}`);
    } else {
      if (!data.nik) data.nik = "KBI-" + Date.now().toString().slice(-6);
      const { error } = await supabaseClient.from("karyawan").insert([data]);
      if (error) throw error;
      showToast("Karyawan baru berhasil ditambahkan", "success");
      logAudit("Tambah Karyawan", `Menambahkan karyawan baru: ${data.nama}`);
    }
    hideModal();
    syncData();
  } catch (err) {
    showToast("Gagal menyimpan: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

function bukaModalEditKaryawan(index) {
  const k = KARYAWAN[index];
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

  document.getElementById("modalKaryawan").style.display = "flex";
}

async function hapusKaryawan(id) {
  if (!confirm("Hapus karyawan ini secara permanen?")) return;

  showLoading(true);
  try {
    const k = KARYAWAN.find(x => x.id == id);
    const { error } = await supabaseClient.from("karyawan").delete().eq("id", id);
    if (error) throw error;

    showToast("Karyawan berhasil dihapus", "success");
    logAudit("Hapus Karyawan", `Menghapus karyawan: ${k ? k.nama : id}`);
    syncData();
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

    let logsKar = allLogs.filter(l => l.nama.trim().toLowerCase() === k.nama.trim().toLowerCase() && l.status === 'MASUK');
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
  document.getElementById("modalEditAbsen").style.display = "flex";
}

function hideEditModal() { document.getElementById("modalEditAbsen").style.display = "none"; }

async function simpanPerubahanAbsen() {
  const id = document.getElementById("editLogId").value;
  const status = document.getElementById("editStatus").value;
  const waktuBaru = document.getElementById("editWaktu").value;
  let telat = false;
  const tglBaru = new Date(waktuBaru);
  // Gunakan toleransi 09:15 untuk manual edit
  if (status === "MASUK") {
    const hh = tglBaru.getHours();
    const mm = tglBaru.getMinutes();
    if (hh > STANDAR_MASUK || (hh === STANDAR_MASUK && mm > TOLERANSI_MASUK_MENIT)) telat = true;
  }
  const { error } = await supabaseClient.from("logs").update({ status, waktu: tglBaru.toISOString(), isLate: telat }).eq("id", id);
  if (!error) { alert("Berhasil!"); hideEditModal(); syncData(); }
}

function zoomFoto(url) {
  const v = document.createElement("div");
  v.style = "position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;justify-content:center;align-items:center;z-index:9999;cursor:pointer;";
  v.onclick = () => v.remove();
  v.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; border-radius:12px;">`;
  document.body.appendChild(v);
}

function exportData() {
  // Ambil filter yang aktif berdasarkan tab yang sedang dibuka
  let tglMulai = document.getElementById("filterTglMulai")?.value;
  let tglSelesai = document.getElementById("filterTglSelesai")?.value;

  const activeTab = document.querySelector('section:not([style*="display: none"])')?.id;
  
  if (activeTab === 'tabLog') {
    tglMulai = document.getElementById("logFilterTglMulai")?.value;
    tglSelesai = document.getElementById("logFilterTglSelesai")?.value;
  } else if (activeTab === 'tabDashboard') {
    tglMulai = document.getElementById("kpiFilterTglMulai")?.value;
    tglSelesai = document.getElementById("kpiFilterTglSelesai")?.value;
  }

  if (allLogs.length === 0) return alert("Belum ada data untuk di-export!");

  showLoading(true);

  // --- SHEET 1: REKAP GAJI & LEMBUR (Summary per Employee) ---
  const dataSummary = KARYAWAN.map(k => {
    const d = hitungDetailGaji(k.gaji || 0, k.nama);
    return {
      "NAMA KARYAWAN": k.nama,
      "NIK": k.nik || "-",
      "JABATAN/DEPT": k.jabatan || k.dept,
      "REKENING": k.rekening || "-",
      "HARI HADIR": d.hadir,
      "TOTAL JAM LEMBUR": parseFloat(d.totalLembur),
      "UANG LEMBUR (RP)": d.uangLembur,
      "GAJI POKOK (RP)": k.gaji || 0,
      "INCENTIVE (RP)": d.incentive || 0,
      "INCENTIVE LUAR (RP)": d.incentiveLuar || 0,
      "POTONGAN (RP)": Math.floor(d.totalPotongan || d.pinjaman),
      "TOTAL GAJI BERSIH / THP (RP)": Math.floor(d.thp)
    };
  });

  // --- SHEET 2: DETAIL LOG ABSENSI (Filtered by Period) ---
  let filteredLogs = allLogs;
  if (tglMulai && tglSelesai) {
    const start = new Date(tglMulai + "T00:00:00");
    const end = new Date(tglSelesai + "T23:59:59");
    filteredLogs = allLogs.filter(l => {
      const w = new Date(l.waktu);
      return w >= start && w <= end;
    });
  }

  const logGroups = {};
  const getShiftDateStrExport = (dateObj) => {
    const d = new Date(dateObj.getTime() - 5 * 3600000);
    return d.toLocaleDateString("id-ID");
  };

  filteredLogs.forEach(l => {
    const norm = l.nama.trim().toLowerCase();
    if (!logGroups[norm]) logGroups[norm] = [];
    logGroups[norm].push(l);
  });

  const dataLogs = [];
  Object.keys(logGroups).forEach(normKey => {
    const userLogs = logGroups[normKey].sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
    let i = 0;
    while (i < userLogs.length) {
      const l = userLogs[i];
      const waktu = new Date(l.waktu);
      let jamLembur = 0;
      const statusUpper = l.status.toUpperCase();

      if (statusUpper === 'MASUK' || statusUpper === 'BERANGKAT') {
        const actualMasuk = waktu;
        const thresholdMasuk = getWIBThreshold(actualMasuk, STANDAR_MASUK);

        // Cari index PULANG terakhir untuk shift ini
        let j = i + 1;
        while (j < userLogs.length && userLogs[j].status.toUpperCase() === 'PULANG') {
          j++;
        }

        if (actualMasuk < thresholdMasuk) {
          jamLembur = (thresholdMasuk - actualMasuk) / (1000 * 60 * 60);
        }

        dataLogs.push({
          "NAMA": l.nama,
          "TANGGAL SHIFT": getShiftDateStrExport(waktu),
          "WAKTU": waktu.toLocaleString("id-ID"),
          "STATUS": l.status,
          "TELAT": l.isLate || l.is_late ? "YA" : "TIDAK",
          "JAM LEMBUR": jamLembur > 0 ? jamLembur.toFixed(2) : 0
        });

        // Proses PULANG-nya
        for (let k = i + 1; k < j; k++) {
          const lp = userLogs[k];
          const wp = new Date(lp.waktu);
          let jamSore = 0;
          if (k === j - 1) {
            const thresholdPulang = getWIBThreshold(actualMasuk, STANDAR_PULANG);
            const diffSore = (wp - thresholdPulang) / (1000 * 60 * 60);
            if (diffSore > 0) jamSore = diffSore;
          }
          dataLogs.push({
            "NAMA": lp.nama,
            "TANGGAL SHIFT": getShiftDateStrExport(wp),
            "WAKTU": wp.toLocaleString("id-ID"),
            "STATUS": lp.status,
            "TELAT": "-",
            "JAM LEMBUR": jamSore > 0 ? jamSore.toFixed(2) : 0
          });
        }
        i = j;
      } else {
        dataLogs.push({
          "NAMA": l.nama,
          "TANGGAL SHIFT": getShiftDateStrExport(waktu),
          "WAKTU": waktu.toLocaleString("id-ID"),
          "STATUS": l.status,
          "TELAT": "-",
          "JAM LEMBUR": 0
        });
        i++;
      }
    }
  });

  // --- CREATE WORKBOOK ---
  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(dataSummary);
  const wsLogs = XLSX.utils.json_to_sheet(dataLogs);

  XLSX.utils.book_append_sheet(wb, wsSummary, "Rekap Gaji & Lembur");
  XLSX.utils.book_append_sheet(wb, wsLogs, "Detail Log Absensi");

  const dateStr = new Date().toLocaleDateString("id-ID").replace(/\//g, "-");
  let fileName = `Payroll_Report_${dateStr}.xlsx`;
  if (tglMulai && tglSelesai) {
    fileName = `Payroll_Report_${tglMulai}_to_${tglSelesai}.xlsx`;
  }
  
  XLSX.writeFile(wb, fileName);
  
  showLoading(false);
  showToast("Payroll Report Berhasil Diunduh", "success");
}

async function hapusSemuaLog() {
  if (confirm("Hapus SEMUA log?")) {
    const { error } = await supabaseClient.from("logs").delete().neq("id", 0);
    if (!error) syncData();
  }
}

async function hapusSatuLog(id) {
  if (confirm("Hapus?")) {
    const { error } = await supabaseClient.from("logs").delete().eq("id", id);
    if (!error) syncData();
  }
}

function exportMasterKaryawan() {
  if (KARYAWAN.length === 0) return alert("Belum ada data karyawan!");

  const dataExcel = KARYAWAN.map(k => ({
    "NIK KBI": k.nik || "-",
    "NAMA LENGKAP": k.nama,
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
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Master Data Karyawan");

  const fileName = `Master_Data_Karyawan_${new Date().toLocaleDateString("id-ID").replace(/\//g, "-")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function setPeriodeIni() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  document.getElementById("filterTglMulai").value = firstDay.toISOString().split('T')[0];
  document.getElementById("filterTglSelesai").value = lastDay.toISOString().split('T')[0];
  refreshUI();
}

function setPeriodeLog() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  document.getElementById("logFilterTglMulai").value = firstDay.toISOString().split('T')[0];
  document.getElementById("logFilterTglSelesai").value = lastDay.toISOString().split('T')[0];
  syncData();
}

window.onload = async () => {
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
  if (KARYAWAN.length === 0) {
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
    for (let i = 0; i < KARYAWAN.length; i++) {
      const k = KARYAWAN[i];
      const d = hitungDetailGaji(k.gaji, k.nama);

      const slipHtml = `
        <div style="font-family: 'Outfit', sans-serif; color: #1e293b; background: white; padding: 40px; border: 1px solid #e2e8f0; position: relative;">
          <div style="position: absolute; top: 20px; right: -35px; background: #fee2e2; color: #ef4444; padding: 5px 40px; transform: rotate(45deg); font-size: 0.6rem; font-weight: 800; letter-spacing: 1px;">CONFIDENTIAL</div>
          
          <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #1e293b; padding-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 15px;">
              <img src="logokoboi.png" alt="Logo KBI" style="width: 50px; border-radius: 8px;">
              <div>
                <h1 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 4px;">PT. KOLA BORASI INDONESIA</h1>
                <p style="font-size: 0.75rem; color: #64748b;">Human Resource Information System</p>
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
              <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.8rem; border-bottom: 1px solid #f8fafc;"><span style="color: #64748b;">OVERTIME (${d.totalLembur} jam)</span><span style="font-weight: 600;">Rp ${Math.floor(d.uangLembur).toLocaleString('id-ID')}</span></div>
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
              "Semoga bermanfaat untuk keluarga. Terus berkarya bersama KOLA BORASI."
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
              <p style="font-size: 0.65rem; color: #64748b; margin-top: 4px;">PT. Kola Borasi Indonesia</p>
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
        .select("*, karyawan(nama, sisa_cuti)")
        .order("created_at", { ascending: false });

    if (error) return console.error(error);

    const body = document.getElementById("adminLeaveBody");
    let html = "";
    leaves.forEach(lv => {
        const statusClass = lv.status === "APPROVED" ? "badge-success" : (lv.status === "REJECTED" ? "badge-danger" : "badge-warning");
        const actions = lv.status === "PENDING" ? `
            <button class="btn btn-primary btn-small" onclick="processLeave('${lv.id}', 'APPROVED', '${lv.employee_id}')">Setujui</button>
            <button class="btn btn-danger btn-small" onclick="processLeave('${lv.id}', 'REJECTED')">Tolak</button>
        ` : "-";

        html += `
            <tr>
                <td><strong>${lv.karyawan.nama}</strong></td>
                <td>${lv.type}</td>
                <td>${lv.start_date} s/d ${lv.end_date}</td>
                <td>${lv.reason}</td>
                <td><span class="badge ${statusClass}">${lv.status}</span></td>
                <td>${actions}</td>
            </tr>
        `;
    });
    body.innerHTML = html;
}

async function processLeave(requestId, status, employeeId) {
    if (!confirm(`Konfirmasi ${status} pengajuan cuti ini?`)) return;

    showLoading(true);
    try {
        const { error } = await supabaseClient
            .from("leave_requests")
            .update({ status: status })
            .eq("id", requestId);

        if (error) throw error;

        if (status === "APPROVED") {
            const { data: emp } = await supabaseClient.from("karyawan").select("sisa_cuti").eq("id", employeeId).single();
            const newBalance = (emp.sisa_cuti || 0) - 1; 
            await supabaseClient.from("karyawan").update({ sisa_cuti: newBalance > 0 ? newBalance : 0 }).eq("id", employeeId);
        }

        showToast(`Cuti berhasil di-${status.toLowerCase()}`, "success");
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
    sel.innerHTML = KARYAWAN.map(k => `<option value="${k.id}">${k.nama}</option>`).join("");
    
    // Trigger metrik update saat ganti karyawan
    sel.onchange = () => updateKpiMetrics();
    
    document.getElementById("modalReview").style.display = "flex";
    updateKpiMetrics();
}

function updateKpiMetrics() {
    const empId = document.getElementById("revKaryawan").value;
    const emp = KARYAWAN.find(k => k.id === empId);
    if (!emp) return;

    const dept = (emp.dept || "DEFAULT").toUpperCase();
    const pos = (emp.jabatan || "DEFAULT").toUpperCase();
    
    // Ambil metrik dari library
    let metrics = [];
    if (KPI_LIBRARY[dept]) {
        metrics = KPI_LIBRARY[dept][pos] || KPI_LIBRARY[dept]["DEFAULT"] || KPI_LIBRARY["DEFAULT"];
    } else {
        metrics = KPI_LIBRARY["DEFAULT"];
    }

    const container = document.getElementById("revKpiContainer");
    if (!container) {
        // Create container if not exists in modal-body
        const target = document.querySelector("#modalReview .modal-body");
        const kpiGroup = document.createElement("div");
        kpiGroup.id = "revKpiContainer";
        kpiGroup.style.marginTop = "20px";
        kpiGroup.style.padding = "15px";
        kpiGroup.style.background = "#f8fafc";
        kpiGroup.style.borderRadius = "12px";
        target.insertBefore(kpiGroup, target.querySelector(".form-group[style*='margin-top:15px']"));
    }

    const kpiCont = document.getElementById("revKpiContainer");
    kpiCont.innerHTML = `<h4 style="font-size:0.8rem; color:var(--primary); margin-bottom:10px;">Metrik KPI (${dept} - ${pos})</h4>`;
    
    metrics.forEach((m, i) => {
        kpiCont.innerHTML += `
            <div class="form-group" style="margin-bottom:10px;">
                <label style="font-size:0.75rem;">${m} (0-100)</label>
                <input type="number" class="form-input kpi-metric-input" data-metric="${m}" value="0" min="0" max="100">
            </div>
        `;
    });
}

function closeReviewModal() {
    document.getElementById("modalReview").style.display = "none";
}

async function saveReview() {
    // Hitung rata-rata dari metrik yang diinput
    const metricInputs = document.querySelectorAll(".kpi-metric-input");
    let totalKpi = 0;
    metricInputs.forEach(input => totalKpi += parseFloat(input.value) || 0);
    const finalKpiScore = metricInputs.length > 0 ? (totalKpi / metricInputs.length) : 0;

    const review = {
        employee_id: document.getElementById("revKaryawan").value,
        period: document.getElementById("revPeriod").value,
        kpi_score: finalKpiScore,
        okr_score: parseFloat(document.getElementById("revOkr").value) || 0,
        notes: document.getElementById("revNotes").value,
        attendance_score: 100, 
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

async function fetchReviews() {
    const { data: reviews, error } = await supabaseClient
        .from("performance_reviews")
        .select("*, karyawan(nama)")
        .order("id", { ascending: false });

    if (error) return;

    const body = document.getElementById("adminPerformanceBody");
    body.innerHTML = reviews.map(r => `
        <tr>
            <td>${r.karyawan.nama}</td>
            <td>${r.period}</td>
            <td>${r.attendance_score}</td>
            <td>${r.kpi_score}</td>
            <td>${r.okr_score}</td>
            <td><span class="badge badge-success">${r.final_grade}</span></td>
            <td><button class="btn btn-outline btn-small" onclick="deleteReview('${r.id}')"><i data-lucide="trash"></i></button></td>
        </tr>
    `).join("");
    lucide.createIcons();
}

async function deleteReview(id) {
    if (!confirm("Hapus penilaian ini?")) return;
    await supabaseClient.from("performance_reviews").delete().eq("id", id);
    fetchReviews();
}
