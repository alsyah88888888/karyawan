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
const TARIF_LEMBUR = 20000; // Rp 20.000 per jam
const TOLERANSI_MASUK_MENIT = 15; // Sampai 09:15 tetap tidak telat

let KARYAWAN = [];
let logs = []; 
let allLogs = []; 

// --- CORE SYNC ---
async function syncData() {
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
  const totalKarEl = document.getElementById("statTotalKaryawan");
  const hadirHariIniEl = document.getElementById("statHadirHariIni");
  const telatHariIniEl = document.getElementById("statTelatHariIni");

  if (totalKarEl) totalKarEl.innerText = KARYAWAN.length;

  const todayStr = new Date().toLocaleDateString();
  const logsToday = allLogs.filter(l => new Date(l.waktu).toLocaleDateString() === todayStr);
  
  const uniqueHadir = [...new Set(logsToday.filter(l => l.status === 'MASUK').map(l => l.nama))].length;
  const totalTelat = logsToday.filter(l => l.status === 'MASUK' && l.isLate).length;

  if (hadirHariIniEl) hadirHariIniEl.innerText = uniqueHadir;
  if (telatHariIniEl) telatHariIniEl.innerText = totalTelat;
}

function switchTab(tab) {
  document.getElementById("tabLog").style.display = tab === 'log' ? 'block' : 'none';
  document.getElementById("tabKaryawan").style.display = tab === 'karyawan' ? 'block' : 'none';
  document.getElementById("btnTabLog").classList.toggle("active", tab === 'log');
  document.getElementById("btnTabKaryawan").classList.toggle("active", tab === 'karyawan');
  if (window.innerWidth <= 768) document.getElementById("sidebar").classList.remove("active");
}

function toggleSidebar() { document.getElementById("sidebar").classList.toggle("active"); }

function renderLogTable() {
  const body = document.getElementById("logTableBody");
  if (!body) return;
  const filter = document.getElementById("filterDept")?.value || "ALL";

  let htmlRows = "";
  logs.forEach((l) => {
    if (filter !== "ALL" && l.dept !== filter) return;
    const sClass = l.status === "MASUK" ? "tag-success" : "tag-indigo";
    const waktuTampil = new Date(l.waktu).toLocaleString("id-ID");
    const telatBadge = l.isLate ? '<span class="tag-amber" style="font-size: 0.6rem; display: block; margin-top: 4px;">TELAT</span>' : "";

    htmlRows += `
      <tr>
        <td><strong>${l.nama}</strong><br><small class="text-muted">${l.dept}</small></td>
        <td>${waktuTampil}</td>
        <td><span class="tag ${sClass}">${l.status}</span> ${telatBadge}</td>
        <td><img src="${l.foto}" class="img-prev" onclick="zoomFoto('${l.foto}')"></td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="bukaModalEdit(${l.id})" style="padding: 4px 8px; font-size: 0.7rem;">EDIT</button>
            <button class="btn btn-outline" onclick="hapusSatuLog(${l.id})" style="padding: 4px 8px; font-size: 0.7rem; color: var(--danger);">HAPUS</button>
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
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
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline" onclick="cetakSlip(${index})" title="Cetak Slip Gaji">📑</button>
            <button class="btn btn-outline" onclick="bukaModalEditKaryawan('${k.id}')" title="Edit Master Data">✏️</button>
            <button class="btn btn-outline" onclick="hapusKaryawan('${k.id}')" style="color: var(--danger);" title="Hapus Karyawan">🗑️</button>
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
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
  const g = parseFloat(gapok) || 0;
  const standarHari = 22;
  const gajiHarian = g / standarHari;
  
  const targetNama = namaKaryawan.trim().toLowerCase();
  const dataLogKaryawan = allLogs
    .filter((l) => l.nama.trim().toLowerCase() === targetNama)
    .sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
  
  const hariHadir = [...new Set(dataLogKaryawan.map((l) => new Date(l.waktu).toISOString().slice(0, 10)))].length;
  const jumlahTelat = dataLogKaryawan.filter((l) => {
    const s = l.status.toUpperCase();
    return (s === "MASUK" || s === "BERANGKAT") && (l.isLate || l.is_late);
  }).length;

  let totalLembur = 0;
  let i = 0;
  
  while (i < dataLogKaryawan.length) {
    const l = dataLogKaryawan[i];
    const statusUpper = l.status.toUpperCase();
    
    // BERANGKAT dianggap sama dengan MASUK
    if (statusUpper === 'MASUK' || statusUpper === 'BERANGKAT') {
      const actualMasuk = new Date(l.waktu);
      const thresholdMasuk = getWIBThreshold(actualMasuk, STANDAR_MASUK);
      
      // 1. LEMBUR PAGI (Masuk/Berangkat < 09:00 WIB)
      if (actualMasuk < thresholdMasuk) {
        let jamPagi = (thresholdMasuk - actualMasuk) / (1000 * 60 * 60);
        if (jamPagi > 0) totalLembur += jamPagi;
      }
      
      // 2. CARI PULANG TERAKHIR UNTUK SHIFT INI
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
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  const uangLembur = (Math.round(totalLembur * 10) / 10) * TARIF_LEMBUR;
  const gajiPro = (hariHadir / standarHari) * g;
  const potonganTelat = jumlahTelat * (gajiHarian * 0.02);
  
  const bpjsKes = gajiPro * 0.01;
  const jht = gajiPro * 0.02;
  const jp = gajiPro * 0.01;
  const pph21 = gajiPro * 0.015;

  const totalPotongan = bpjsKes + jht + jp + pph21 + potonganTelat;
  const thp = gajiPro + uangLembur - totalPotongan;

  return { 
    gapok: g, 
    gajiPro, 
    hadir: hariHadir, 
    jumlahTelat, 
    totalLembur: totalLembur.toFixed(2), 
    uangLembur, 
    totalPotongan, 
    thp: thp > 0 ? thp : 0 
  };
}

// --- MODAL & ACTIONS ---
function showModal() {
    document.getElementById("modalTitle").innerText = "Tambah Karyawan (Master Data)";
    document.getElementById("editKaryawanId").value = "";
    document.getElementById("btnSimpanKaryawan").innerText = "Simpan Master Data";
    
    // Reset Form
    const fields = ["inpNama", "inpNikKtp", "inpWa", "inpJabatan", "inpCuti", "inpPin", "inpGaji", "inpRekening", "inpNpwp", "inpPinjaman"];
    fields.forEach(f => document.getElementById(f).value = (f === "inpCuti" ? 12 : (f === "inpPinjaman" ? 0 : "")));
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
    pin: document.getElementById("inpPin").value,
    gaji: parseFloat(document.getElementById("inpGaji").value) || 0,
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
    data.nik = "KBI-" + Date.now().toString().slice(-6); // Generate NIK KBI
    const { error } = await supabaseClient.from("karyawan").insert([data]);
    if (!error) { alert("Karyawan Baru Berhasil Ditambahkan!"); hideModal(); syncData(); }
    else alert("Gagal Simpan: " + error.message);
  }
}

function bukaModalEditKaryawan(id) {
    const k = KARYAWAN.find(item => item.id == id);
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
    document.getElementById("inpPin").value = k.pin || "";
    document.getElementById("inpGaji").value = k.gaji || 0;
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

window.onload = syncData;
