/**
 * KOBOI ADMIN - PREMIUM LOGIC
 * Manages statistics, employees, attendance logs, and payroll.
 */

// 1. CONFIGURATION
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

let KARYAWAN = [];
let logs = []; // Limited logs for UI (with photos)
let allLogs = []; // Full logs for calculations

// --- CORE SYNC ---
async function syncData() {
  try {
    console.log("Syncing Cloud Data...");

    // 1. Fetch Employees
    const { data: dataKar, error: errKar } = await supabaseClient
      .from("karyawan")
      .select("*")
      .order("nama", { ascending: true });

    if (errKar) throw errKar;
    KARYAWAN = dataKar || [];

    // 2. Fetch ALL logs (text only for speed)
    const { data: dataAllLog, error: errAllLog } = await supabaseClient
      .from("logs")
      .select("id, nama, dept, waktu, status, isLate")
      .order("id", { ascending: false });

    if (errAllLog) throw errAllLog;
    allLogs = dataAllLog || [];

    // 3. Fetch recent logs (with photos for table)
    const { data: dataLog, error: errLog } = await supabaseClient
      .from("logs")
      .select("*")
      .order("id", { ascending: false })
      .limit(200);

    if (errLog) throw errLog;
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

  // Close sidebar on mobile after selecting a tab
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("active");
  }
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("active");
}

function renderLogTable() {
  const body = document.getElementById("logTableBody");
  if (!body) return;
  const filter = document.getElementById("filterDept")?.value || "ALL";

  let htmlRows = "";
  logs.forEach((l) => {
    if (filter !== "ALL" && l.dept !== filter) return;

    const sClass = l.status === "MASUK" ? "tag-success" : "tag-indigo";
    const waktuTampil = new Date(l.waktu).toLocaleString("id-ID");
    const telatBadge = l.isLate
      ? '<span class="tag-amber" style="font-size: 0.6rem; display: block; margin-top: 4px;">TELAT</span>'
      : "";

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
        <td style="font-family: monospace; font-size: 0.8rem;">${k.rekening || "-"}</td>
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

// --- PAYROLL LOGIC ---
function hitungDetailGaji(gapok, namaKaryawan) {
  const g = parseFloat(gapok) || 0;
  const standarHari = 22;
  const gajiHarian = g / standarHari;
  const dataLogKaryawan = allLogs.filter((l) => l.nama === namaKaryawan);
  
  const hariHadir = [...new Set(dataLogKaryawan.filter((l) => l.status === "MASUK").map((l) => new Date(l.waktu).toLocaleDateString()))].length;
  const jumlahTelat = dataLogKaryawan.filter((l) => l.status === "MASUK" && (l.isLate || l.is_late)).length;

  const gajiPro = (hariHadir / standarHari) * g;
  const potonganTelat = jumlahTelat * (gajiHarian * 0.02);
  const bpjsKes = gajiPro * 0.01;
  const jht = gajiPro * 0.02;
  const jp = gajiPro * 0.01;
  const pph21 = gajiPro * 0.015;

  const totalPotongan = bpjsKes + jht + jp + pph21 + potonganTelat;
  const thp = gajiPro - totalPotongan;

  return { gapok: g, gajiPro, hadir: hariHadir, jumlahTelat, potonganTelat, bpjsKes, jht, jp, pph21, totalPotongan, thp: thp > 0 ? thp : 0 };
}

// --- MODAL & ACTION HANDLERS ---
function showModal() { document.getElementById("modalKaryawan").style.display = "flex"; }
function hideModal() { document.getElementById("modalKaryawan").style.display = "none"; }

async function simpanKaryawan() {
  const nama = document.getElementById("inpNama").value.toUpperCase();
  const gaji = document.getElementById("inpGaji").value;
  const dept = document.getElementById("inpDept").value;
  const rek = document.getElementById("inpRekening").value;

  if (!nama || !gaji) return alert("Harap isi Nama dan Gaji!");

  const newKar = { 
    nama, 
    dept, 
    rekening: rek, 
    gaji: parseFloat(gaji), 
    nik: "KBI-" + Date.now().toString().slice(-6) 
  };

  const { error } = await supabaseClient.from("karyawan").insert([newKar]);
  if (!error) {
    alert("Karyawan Berhasil Ditambahkan!");
    hideModal();
    await syncData();
  } else {
    alert("Gagal: " + error.message);
  }
}

async function hapusKaryawan(id) {
  if (confirm("Hapus data karyawan ini?")) {
    const { error } = await supabaseClient.from("karyawan").delete().eq("id", id);
    if (!error) await syncData();
  }
}

function bukaModalEdit(id) {
  const log = logs.find((l) => l.id === id);
  if (!log) return;

  document.getElementById("editLogId").value = log.id;
  document.getElementById("editNama").value = log.nama;
  document.getElementById("editStatus").value = log.status;

  const date = new Date(log.waktu);
  const formatted = date.toISOString().slice(0, 16);
  document.getElementById("editWaktu").value = formatted;

  document.getElementById("modalEditAbsen").style.display = "flex";
}

function hideEditModal() { document.getElementById("modalEditAbsen").style.display = "none"; }

async function simpanPerubahanAbsen() {
  const id = document.getElementById("editLogId").value;
  const status = document.getElementById("editStatus").value;
  const waktuBaru = document.getElementById("editWaktu").value;

  let telat = false;
  const tglBaru = new Date(waktuBaru);
  if (status === "MASUK" && (tglBaru.getHours() > 9 || (tglBaru.getHours() === 9 && tglBaru.getMinutes() > 0))) telat = true;

  const { error } = await supabaseClient
    .from("logs")
    .update({ status, waktu: tglBaru.toISOString(), isLate: telat })
    .eq("id", id);

  if (!error) {
    alert("Update Berhasil!");
    hideEditModal();
    await syncData();
  }
}

// --- UTILITIES ---
function zoomFoto(url) {
  const v = document.createElement("div");
  v.style = "position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;justify-content:center;align-items:center;z-index:9999;cursor:pointer;";
  v.onclick = () => v.remove();
  v.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; border-radius:12px; box-shadow: 0 0 20px rgba(255,255,255,0.2);">`;
  document.body.appendChild(v);
}

function exportData() {
  let csv = "Nama,Dept,Waktu,Status,Telat\n";
  allLogs.forEach(l => csv += `${l.nama},${l.dept},${l.waktu},${l.status},${l.isLate}\n`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `Rekap_Absensi_${new Date().toLocaleDateString()}.csv`;
  a.click();
}

async function clearData() {
  if (confirm("Hapus SELURUH LOG absensi? Tindakan ini tidak bisa dibatalkan!")) {
    const { error } = await supabaseClient.from("logs").delete().neq("id", 0);
    if (!error) await syncData();
  }
}

async function hapusSatuLog(id) {
  if (confirm("Hapus log ini?")) {
    const { error } = await supabaseClient.from("logs").delete().eq("id", id);
    if (!error) await syncData();
  }
}

window.onload = syncData;
