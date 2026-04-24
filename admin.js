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
let INCENTIVE_APPROVED = true; // Status Persetujuan CEO

// --- CORE SYNC ---
async function syncData() {
  if (!document.getElementById("filterTglMulai").value) setPeriodeIni();
  try {
    const { data: dataKar } = await supabaseClient.from("karyawan").select("*").order("nama", { ascending: true });
    KARYAWAN = dataKar || [];

    const { data: dataAllLog } = await supabaseClient.from("logs").select("id, nama, dept, waktu, status, isLate").order("id", { ascending: false });
    allLogs = dataAllLog || [];

    const { data: dataLog } = await supabaseClient.from("logs").select("*").order("id", { ascending: false }).limit(200);
    logs = dataLog || [];

    refreshUI();
  } catch (e) {
    console.error("Sync Failed:", e.message);
  }
}

function refreshUI() {
  renderStats();
  renderLogTable();
  renderKaryawanTable();
}

// --- DASHBOARD UI ---
function renderStats() {
  const manpowerEl = document.getElementById("statManpower");
  const hadirEl = document.getElementById("statHadir");
  const terlambatEl = document.getElementById("statTerlambat");

  if (manpowerEl) manpowerEl.innerText = KARYAWAN.length;

  const todayStr = new Date().toLocaleDateString();
  const logsToday = allLogs.filter(l => new Date(l.waktu).toLocaleDateString() === todayStr);

  const uniqueHadir = [...new Set(logsToday.filter(l => l.status === 'MASUK').map(l => l.nama))].length;
  const totalTelat = logsToday.filter(l => l.status === 'MASUK' && l.isLate).length;

  if (hadirEl) hadirEl.innerText = uniqueHadir;
  if (terlambatEl) terlambatEl.innerText = totalTelat;
}

function switchTab(tab) {
  const tabs = ["tabLog", "tabKaryawan", "tabCEO"];
  tabs.forEach((t) => {
    const el = document.getElementById(t);
    if (el) el.style.display = t === tab ? "block" : "none";
  });

  // Update Sidebar Active States
  const links = ["linkTabLog", "linkTabKaryawan", "linkTabCEO"];
  links.forEach(l => {
    const el = document.getElementById(l);
    if (el) el.classList.toggle("active", l.includes(tab.replace('tab', '')));
  });

  const title = document.getElementById("pageTitle");
  if (title) {
    if (tab === "tabLog") title.innerText = "Log Absensi Real-time";
    else if (tab === "tabCEO") title.innerText = "Direksi / CEO Panel";
    else title.innerText = "Manajemen Karyawan";
  }
  
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function toggleIncentiveCEO() {
  INCENTIVE_APPROVED = !INCENTIVE_APPROVED;
  refreshCEOPanel();
  refreshUI(); // Hitung ulang payroll di tabel
  alert(`Status Insentif Berhasil Diubah: ${INCENTIVE_APPROVED ? "AKTIF" : "NON-AKTIF"}`);
}

function refreshCEOPanel() {
  const statusEl = document.getElementById("ceoIncentiveStatus");
  if (!statusEl) return;
  
  if (INCENTIVE_APPROVED) {
    statusEl.innerText = "STATUS: AKTIF (DISETUJUI CEO)";
    statusEl.style.background = "var(--success)";
  } else {
    statusEl.innerText = "STATUS: NON-AKTIF (BELUM DISETUJUI)";
    statusEl.style.background = "var(--danger)";
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
          <div style="font-weight: 600;">${tgl.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</div>
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
          <div style="font-weight: 800; color: var(--dark);">${k.nama}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${k.nik || "-"}</div>
        </td>
        <td>
          <div style="font-weight: 600;">${k.jabatan || k.dept}</div>
          <div style="font-size: 0.75rem; color: #64748b;">Hadir: ${d.hadir}/22</div>
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

function hitungDetailGaji(gapok, namaKaryawan) {
  const targetNama = namaKaryawan.trim().toLowerCase();
  const k = KARYAWAN.find(item => item.nama.trim().toLowerCase() === targetNama);
  
  const tglMulai = document.getElementById("filterTglMulai")?.value;
  const tglSelesai = document.getElementById("filterTglSelesai")?.value;

  const g = parseFloat(gapok) || 0;
  const hkeRate = k ? (parseFloat(k.hke_rate) || 50000) : 50000;
  const incentive = (k && INCENTIVE_APPROVED) ? (parseFloat(k.incentive) || 0) : 0;
  const incentiveLuar = (k && INCENTIVE_APPROVED) ? (parseFloat(k.incentive_luar) || 0) : 0;
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
  
  const hariHadir = [...new Set(dataLogKaryawan.map((l) => new Date(l.waktu).toISOString().slice(0, 10)))].length;

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
  const date = new Date();
  const monthNames = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  const period = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;

  const html = `
    <html>
    <head>
      <title>Slip Gaji - ${k.nama}</title>
      <style>
        body { font-family: 'Inter', sans-serif; padding: 40px; color: #333; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
        .logo-box { text-align: left; }
        .logo-box img { width: 120px; }
        .company-info { text-align: right; }
        .company-info h2 { margin: 0; color: #b45309; font-size: 1.2rem; }
        .company-info p { margin: 2px 0; font-size: 0.8rem; }
        
        .slip-title { text-align: right; margin-bottom: 20px; }
        .slip-title h3 { margin: 0; font-size: 1.1rem; text-decoration: underline; }
        .slip-title p { margin: 0; font-size: 0.9rem; font-weight: 700; }

        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 20px; font-size: 0.85rem; }
        .info-row { display: flex; margin-bottom: 4px; }
        .info-label { width: 120px; font-weight: 600; }
        
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 0.85rem; }
        th { background: #f8fafc; text-align: left; padding: 8px; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; }
        td { padding: 6px 8px; }
        .row-total { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; font-weight: 800; }
        .val { text-align: right; }
        
        .footer { display: flex; justify-content: space-between; margin-top: 40px; font-size: 0.85rem; }
        .sign-box { text-align: center; width: 200px; }
        .sign-space { height: 60px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo-box">
          <img src="logokoboi.png" alt="Logo">
        </div>
        <div class="company-info">
          <h2>PT. KOLA BORASI INDONESIA</h2>
          <p>Jl. Arjuna IV Green Kartika Residence Blok EE No.2</p>
          <p>Cibinong, Bogor - Jawa Barat 16911</p>
        </div>
      </div>

      <div class="slip-title">
        <h3>SLIP GAJI</h3>
        <p>${period}</p>
      </div>

      <div class="info-grid">
        <div>
          <div class="info-row"><div class="info-label">NAMA</div><div>: ${k.nama}</div></div>
          <div class="info-row"><div class="info-label">JABATAN</div><div>: ${k.jabatan || '-'}</div></div>
        </div>
        <div>
          <div class="info-row"><div class="info-label">WILAYAH KERJA</div><div>: CIBINONG</div></div>
          <div class="info-row"><div class="info-label">DEPARTEMEN</div><div>: ${k.dept}</div></div>
        </div>
      </div>

      <table>
        <tr>
          <th>PENDAPATAN</th>
          <th></th>
          <th class="val">POTONGAN</th>
          <th class="val"></th>
        </tr>
        <tr>
          <td>GAJI POKOK</td>
          <td class="val">Rp ${d.gapok.toLocaleString('id-ID')}</td>
          <td>PINJAMAN KANTOR</td>
          <td class="val">Rp ${d.pinjaman.toLocaleString('id-ID')}</td>
        </tr>
        <tr>
          <td>HKE (${d.hadir} x Rp ${d.hkeRate.toLocaleString('id-ID')})</td>
          <td class="val">Rp ${d.uangHKE.toLocaleString('id-ID')}</td>
          <td></td>
          <td></td>
        </tr>
        <tr>
          <td>INCENTIVE</td>
          <td class="val">Rp ${d.incentive.toLocaleString('id-ID')}</td>
          <td></td>
          <td></td>
        </tr>
        <tr>
          <td>INCENTIVE (LK/NGINAP)</td>
          <td class="val">Rp ${d.incentiveLuar.toLocaleString('id-ID')}</td>
          <td></td>
          <td></td>
        </tr>
        <tr>
          <td>OVERTIME (${d.totalLembur} JAM)</td>
          <td class="val">Rp ${d.uangLembur.toLocaleString('id-ID')}</td>
          <td></td>
          <td></td>
        </tr>
        <tr class="row-total">
          <td>JUMLAH PENDAPATAN</td>
          <td class="val">Rp ${(d.gapok + d.uangHKE + d.incentive + d.incentiveLuar + d.uangLembur).toLocaleString('id-ID')}</td>
          <td>JUMLAH POTONGAN</td>
          <td class="val">Rp ${d.pinjaman.toLocaleString('id-ID')}</td>
        </tr>
      </table>

      <div style="display: flex; align-items: center; gap: 20px;">
        <span style="font-weight: 800; font-size: 1rem;">GAJI BERSIH :</span>
        <div style="border: 2px solid #000; padding: 5px 30px; font-weight: 800; font-size: 1.1rem;">
          Rp ${Math.floor(d.thp).toLocaleString('id-ID')}
        </div>
      </div>

      <div class="footer">
        <div class="sign-box">
          <p>CIBINONG, ${new Date().toLocaleDateString('id-ID', {day:'numeric', month:'long', year:'numeric'})}</p>
          <p>Dibuat Oleh,</p>
          <div class="sign-space"></div>
          <p><strong>ADMIN</strong></p>
        </div>
        <div class="sign-box">
          <p>&nbsp;</p>
          <p>Diterima Oleh,</p>
          <div class="sign-space"></div>
          <p><strong>${k.nama}</strong></p>
        </div>
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
  pesan += `Gaji Pokok: Rp ${d.gapok.toLocaleString('id-ID')}\n`;
  pesan += `HKE (${d.hadir} hari): Rp ${d.uangHKE.toLocaleString('id-ID')}\n`;
  if (d.incentive > 0) pesan += `Incentive: Rp ${d.incentive.toLocaleString('id-ID')}\n`;
  if (d.incentiveLuar > 0) pesan += `Incentive Luar Kota: Rp ${d.incentiveLuar.toLocaleString('id-ID')}\n`;
  pesan += `Lembur (${d.totalLembur} jam): Rp ${d.uangLembur.toLocaleString('id-ID')}\n`;
  
  if (d.pinjaman > 0) {
    pesan += `----------------------------------\n`;
    pesan += `Potongan Pinjaman: Rp ${d.pinjaman.toLocaleString('id-ID')}\n`;
  }

  pesan += `----------------------------------\n`;
  pesan += `*GAJI BERSIH (THP): Rp ${Math.floor(d.thp).toLocaleString('id-ID')}*\n`;
  pesan += `----------------------------------\n`;
  pesan += `_Pesan otomatis dari Sistem HRIS KOBOI_`;

  // Format nomor (ubah 0 jadi 62)
  let noWa = k.nomor_wa.trim();
  if (noWa.startsWith("0")) noWa = "62" + noWa.slice(1);
  else if (!noWa.startsWith("62")) noWa = "62" + noWa;

  const url = `https://wa.me/${noWa}?text=${encodeURIComponent(pesan)}`;
  window.open(url, '_blank');
}

// --- MODAL & ACTIONS ---
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

  if (id) {
    // UPDATE
    const { error } = await supabaseClient.from("karyawan").update(data).eq("id", id);
    if (!error) { alert("Data Berhasil Diperbarui!"); hideModal(); syncData(); }
    else alert("Gagal Update: " + error.message);
  } else {
    // INSERT NEW
    if (!data.nik) data.nik = "KBI-" + Date.now().toString().slice(-6); // Auto-generate if empty
    const { error } = await supabaseClient.from("karyawan").insert([data]);
    if (!error) { alert("Karyawan Baru Berhasil Ditambahkan!"); hideModal(); syncData(); }
    else alert("Gagal Simpan: " + error.message);
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
  if (confirm("Hapus?")) {
    const { error } = await supabaseClient.from("karyawan").delete().eq("id", id);
    if (!error) syncData();
  }
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
  if (allLogs.length === 0) return alert("Belum ada data untuk di-export!");

  // --- SHEET 1: REKAP GAJI & LEMBUR (Summary per Employee) ---
  const dataSummary = KARYAWAN.map(k => {
    const d = hitungDetailGaji(k.gaji || 0, k.nama);
    return {
      "NAMA KARYAWAN": k.nama,
      "NIK": k.nik || "-",
      "JABATAN/DEPT": k.jabatan || k.dept,
      "HARI HADIR": d.hadir,
      "TOTAL JAM LEMBUR": parseFloat(d.totalLembur),
      "UANG LEMBUR (RP)": d.uangLembur,
      "GAJI POKOK (RP)": k.gaji || 0,
      "POTONGAN (RP)": Math.floor(d.totalPotongan),
      "TOTAL GAJI BERSIH / THP (RP)": Math.floor(d.thp)
    };
  });

  // --- SHEET 2: DETAIL LOG ABSENSI (Chronological pairing) ---
  const logGroups = {};
  allLogs.forEach(l => {
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

  const fileName = `Payroll_Report_${new Date().toLocaleDateString("id-ID").replace(/\//g, "-")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

async function clearData() {
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

window.onload = syncData;
