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
        <td><strong>${k.nama}</strong><br><small>${k.nik || "-"}</small></td>
        <td>${k.jabatan || k.dept}<br><small>Hadir: ${d.hadir}/22</small></td>
        <td><strong>${d.totalLembur} Jam</strong><br><small>+ Rp ${d.uangLembur.toLocaleString("id-ID")}</small></td>
        <td><strong>Rp ${(k.gaji || 0).toLocaleString("id-ID")}</strong></td>
        <td style="color: var(--success); font-weight: 800;">Rp ${Math.floor(d.thp).toLocaleString("id-ID")}</td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="cetakSlip(${index})">SLIP</button>
            <button class="btn btn-outline" onclick="hapusKaryawan('${k.id}')" style="color: var(--danger);">HAPUS</button>
          </div>
        </td>
      </tr>`;
  });
  body.innerHTML = htmlRows;
}

// --- PAYROLL & OVERTIME LOGIC ---
function hitungDetailGaji(gapok, namaKaryawan) {
  const g = parseFloat(gapok) || 0;
  const standarHari = 22;
  const gajiHarian = g / standarHari;
  
  // Ambil log karyawan & urutkan kronologis
  const dataLogKaryawan = allLogs
    .filter((l) => l.nama === namaKaryawan)
    .sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
  
  const hariHadir = [...new Set(dataLogKaryawan.filter((l) => l.status === "MASUK").map((l) => new Date(l.waktu).toLocaleDateString()))].length;
  const jumlahTelat = dataLogKaryawan.filter((l) => l.status === "MASUK" && (l.isLate || l.is_late)).length;

  let totalLembur = 0;
  let i = 0;
  while (i < dataLogKaryawan.length) {
    const l = dataLogKaryawan[i];
    
    if (l.status === 'MASUK') {
      const shiftStart = new Date(l.waktu);
      // Cari PULANG terakhir sebelum ada MASUK baru
      let shiftEnd = null;
      let j = i + 1;
      while (j < dataLogKaryawan.length && dataLogKaryawan[j].status === 'PULANG') {
        shiftEnd = new Date(dataLogKaryawan[j].waktu);
        j++;
      }
      
      // Hitung LEMBUR PAGI (Hanya dari MASUK pertama)
      if (shiftStart.getHours() < STANDAR_MASUK) {
        const batasMasuk = new Date(shiftStart);
        batasMasuk.setHours(STANDAR_MASUK, 0, 0, 0);
        let jamPagi = (batasMasuk - shiftStart) / (1000 * 60 * 60);
        if (jamPagi > 0) totalLembur += jamPagi;
      }
      
      // Hitung LEMBUR SORE (Dari PULANG terakhir jika ada)
      if (shiftEnd) {
        const batasSore = new Date(shiftStart);
        batasSore.setHours(STANDAR_PULANG, 0, 0, 0);
        let jamSore = (shiftEnd - batasSore) / (1000 * 60 * 60);
        if (jamSore > 0) totalLembur += jamSore;
        i = j; // Loncat ke log setelah PULANG terakhir
      } else {
        i++; // Tidak ada PULANG, lanjut ke log berikutnya
      }
    } else {
      i++; // Bukan MASUK (log yatim), abaikan
    }
  }

  const uangLembur = Math.round(totalLembur * 10) / 10 * TARIF_LEMBUR; // Pembulatan per 0.1 jam agar lebih adil
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
    totalLembur: totalLembur.toFixed(1), // Satu desimal untuk akurasi
    uangLembur, 
    totalPotongan, 
    thp: thp > 0 ? thp : 0 
  };
}

// --- MODAL & ACTIONS ---
function showModal() { document.getElementById("modalKaryawan").style.display = "flex"; }
function hideModal() { document.getElementById("modalKaryawan").style.display = "none"; }

async function simpanKaryawan() {
  const nama = document.getElementById("inpNama").value.toUpperCase();
  const gaji = document.getElementById("inpGaji").value;
  const dept = document.getElementById("inpDept").value;
  const rek = document.getElementById("inpRekening").value;
  if (!nama || !gaji) return alert("Harap isi Nama dan Gaji!");
  const newKar = { nama, dept, rekening: rek, gaji: parseFloat(gaji), nik: "KBI-" + Date.now().toString().slice(-6) };
  const { error } = await supabaseClient.from("karyawan").insert([newKar]);
  if (!error) { alert("Berhasil!"); hideModal(); syncData(); }
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

  // Siapkan data per Nama untuk proses pairing di export
  const logGroups = {};
  allLogs.forEach(l => {
    if (!logGroups[l.nama]) logGroups[l.nama] = [];
    logGroups[l.nama].push(l);
  });

  const dataExcel = [];

  Object.keys(logGroups).forEach(nama => {
    const userLogs = logGroups[nama].sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
    let i = 0;
    
    while (i < userLogs.length) {
      const l = userLogs[i];
      const waktu = new Date(l.waktu);
      let jamLembur = 0;

      if (l.status === 'MASUK') {
        const shiftStart = waktu;
        // Cari PULANG terakhir
        let lastP = null;
        let j = i + 1;
        while (j < userLogs.length && userLogs[j].status === 'PULANG') {
          lastP = new Date(userLogs[j].waktu);
          j++;
        }

        // Tentukan lembur pagi untuk baris ini
        if (shiftStart.getHours() < STANDAR_MASUK) {
          const batasMasuk = new Date(shiftStart);
          batasMasuk.setHours(STANDAR_MASUK, 0, 0, 0);
          jamLembur = (batasMasuk - shiftStart) / (1000 * 60 * 60);
        }

        dataExcel.push({
          "NAMA KARYAWAN": l.nama,
          "DEPARTEMEN": l.dept,
          "WAKTU ABSENSI": waktu.toLocaleString("id-ID"),
          "STATUS": l.status,
          "TERLAMBAT": l.isLate ? "YA" : "TIDAK",
          "JAM LEMBUR": jamLembur > 0 ? jamLembur.toFixed(1) : 0
        });

        // Loop untuk memproses PULANG-nya
        for (let k = i + 1; k < j; k++) {
          const lp = userLogs[k];
          const wp = new Date(lp.waktu);
          let jamSore = 0;
          
          // Hanya hitung lembur sore pada PULANG TERAKHIR
          if (k === j - 1) {
            const batasSore = new Date(shiftStart);
            batasSore.setHours(STANDAR_PULANG, 0, 0, 0);
            const diffSore = (wp - batasSore) / (1000 * 60 * 60);
            if (diffSore > 0) jamSore = diffSore;
          }

          dataExcel.push({
            "NAMA KARYAWAN": lp.nama,
            "DEPARTEMEN": lp.dept,
            "WAKTU ABSENSI": wp.toLocaleString("id-ID"),
            "STATUS": lp.status,
            "TERLAMBAT": lp.isLate ? "YA" : "TIDAK",
            "JAM LEMBUR": jamSore > 0 ? jamSore.toFixed(1) : 0
          });
        }
        i = j;
      } else {
        // Log yatim (PULANG tanpa MASUK di depannya)
        dataExcel.push({
          "NAMA KARYAWAN": l.nama,
          "DEPARTEMEN": l.dept,
          "WAKTU ABSENSI": waktu.toLocaleString("id-ID"),
          "STATUS": l.status,
          "TERLAMBAT": l.isLate ? "YA" : "TIDAK",
          "JAM LEMBUR": 0
        });
        i++;
      }
    }
  });

  // 2. Buat Workbook & Worksheet
  const ws = XLSX.utils.json_to_sheet(dataExcel);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rekap Absensi");

  const fileName = `Laporan_Presensi_${new Date().toLocaleDateString("id-ID").replace(/\//g, "-")}.xlsx`;
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

window.onload = syncData;
