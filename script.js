/**
 * KOBOI PRESENSI - FULL CLOUD VERSION
 * Fitur: Cloud Sync, Absensi, Manajemen Karyawan, & Payroll PDF
 * PT. Kola Borasi Indonesia - Februari 2026
 */

// 1. KONFIGURASI SUPABASE
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo"; // Pastikan ini adalah Anon Public Key Anda
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

const OFFICE_IP = "103.108.130.34";
let KARYAWAN = [];
let logs = [];

// --- FUNGSI CLOUD SYNC ---
async function syncData() {
  try {
    console.log("Sinkronisasi data ke Cloud...");

    // Ambil Data Karyawan (Urutkan Nama)
    const { data: dataKar, error: errKar } = await supabaseClient
      .from("karyawan")
      .select("*")
      .order("nama", { ascending: true });
    if (errKar) throw errKar;
    KARYAWAN = dataKar || [];

    // Ambil Data Logs (Terbaru di atas)
    const { data: dataLog, error: errLog } = await supabaseClient
      .from("logs")
      .select("*")
      .order("id", { ascending: false });
    if (errLog) throw errLog;
    logs = dataLog || [];

    refreshAllUI();
  } catch (e) {
    console.error("Gagal sinkronisasi:", e.message);
  }
}

function refreshAllUI() {
  const isUserPage = document.getElementById("namaSelect");
  const isAdminPage = document.getElementById("logTableBody");

  if (isUserPage) {
    const sel = document.getElementById("namaSelect");
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Pilih Nama Anda --</option>';
    KARYAWAN.forEach((k) => {
      sel.innerHTML += `<option value="${k.nama}">${k.nama}</option>`;
    });
    sel.value = currentVal;
  }

  if (isAdminPage) {
    renderTabel();
    renderKaryawanTable();
  }
}

// --- INISIALISASI ---
window.onload = async () => {
  await syncData();
  if (document.getElementById("namaSelect")) initUser();
};

// --- LOGIKA PAYROLL ---
function hitungDetailGaji(gapok, namaKaryawan) {
  const g = parseFloat(gapok) || 0;
  const standarHari = 22;
  const gajiHarian = g / standarHari;

  const dataLogKaryawan = logs.filter((l) => l.nama === namaKaryawan);
  const hadir = dataLogKaryawan.filter((l) => l.status === "MASUK").length;
  const jumlahTelat = dataLogKaryawan.filter(
    (l) => l.status === "MASUK" && l.isLate === true,
  ).length;

  const potonganTelat = jumlahTelat * (gajiHarian * 0.02);
  const gajiPro = (hadir / standarHari) * g;

  const bpjsKes = gajiPro * 0.01;
  const jht = gajiPro * 0.02;
  const jp = gajiPro * 0.01;
  const pph21 = gajiPro * 0.015;

  const totalPotongan = bpjsKes + jht + jp + pph21 + potonganTelat;
  const thp = gajiPro - totalPotongan;

  return {
    gapok: g,
    gajiPro,
    hadir,
    jumlahTelat,
    potonganTelat,
    standarHari,
    bpjsKes,
    jht,
    jp,
    pph21,
    totalPotongan,
    thp,
  };
}

// --- LOGIKA USER & ABSENSI ---
async function initUser() {
  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((s) => (document.getElementById("video").srcObject = s))
    .catch(() =>
      alert("Izin kamera ditolak! Aplikasi membutuhkan kamera untuk absensi."),
    );

  setInterval(() => {
    const clockEl = document.getElementById("liveClock");
    if (clockEl) clockEl.innerText = new Date().toLocaleTimeString("id-ID");
  }, 1000);

  const badge = document.getElementById("wifiStatus");
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    const isOffice = data.ip === OFFICE_IP;
    badge.innerText = isOffice
      ? "Terhubung WiFi Kantor ✅"
      : `Gunakan WiFi Kantor ❌ (${data.ip})`;
    badge.className = isOffice
      ? "wifi-badge connected"
      : "wifi-badge disconnected";
    document.getElementById("btnMasuk").disabled = !isOffice;
    document.getElementById("btnPulang").disabled = !isOffice;
  } catch (e) {
    if (badge) badge.innerText = "Gagal Verifikasi Jaringan / Offline";
  }
}

async function prosesAbsen(tipe) {
  const nama = document.getElementById("namaSelect").value;
  if (!nama) return alert("Pilih Nama Anda!");

  const sekarang = new Date();
  const tglHariIni = sekarang.toLocaleDateString("id-ID");

  // Pengecekan Duplikat Absen
  const sudahAbsen = logs.find(
    (l) =>
      l.nama === nama &&
      new Date(l.waktu).toLocaleDateString("id-ID") === tglHariIni &&
      l.status === tipe,
  );
  if (sudahAbsen) return alert(`Anda SUDAH absen ${tipe} hari ini!`);

  // Ambil Foto
  const v = document.getElementById("video");
  const c = document.getElementById("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);

  let telat = false;
  if (tipe === "MASUK") {
    const jam = sekarang.getHours();
    const menit = sekarang.getMinutes();
    if (jam > 9 || (jam === 9 && menit > 0)) telat = true;
  }

  const info = KARYAWAN.find((k) => k.nama === nama);
  const newLog = {
    nama: info.nama,
    dept: info.dept,
    waktu: sekarang.toISOString(), // Simpan format ISO agar sorting di Cloud benar
    status: tipe,
    foto: c.toDataURL("image/webp", 0.3),
    isLate: telat,
  };

  const { error } = await supabaseClient.from("logs").insert([newLog]);
  if (error) {
    alert("Gagal kirim ke Cloud: " + error.message);
  } else {
    alert(
      telat
        ? "Berhasil! Anda telat (Potongan 2% otomatis)."
        : "Berhasil! Selamat Bekerja.",
    );
    await syncData();
  }
}

// --- LOGIKA ADMIN ---
function switchTab(tab) {
  document.getElementById("tabLog").style.display =
    tab === "log" ? "block" : "none";
  document.getElementById("tabKaryawan").style.display =
    tab === "kar" ? "block" : "none";
  document
    .getElementById("btnTabLog")
    .classList.toggle("nav-active", tab === "log");
  document
    .getElementById("btnTabKaryawan")
    .classList.toggle("nav-active", tab === "kar");
}

function renderTabel() {
  const body = document.getElementById("logTableBody");
  if (!body) return;
  const filter = document.getElementById("filterDept")?.value || "ALL";
  body.innerHTML = "";
  let count = 0;

  logs.forEach((l) => {
    if (filter !== "ALL" && l.dept !== filter) return;
    count++;
    const sClass = l.status === "MASUK" ? "status-masuk" : "status-pulang";
    const waktuTampil = new Date(l.waktu).toLocaleString("id-ID");
    const telatBadge = l.isLate
      ? '<br><small style="color:red;font-weight:bold;">(TELAT)</small>'
      : "";

    body.innerHTML += `
            <tr>
                <td><strong>${l.nama}</strong></td>
                <td>${l.dept}</td>
                <td>${waktuTampil}</td>
                <td><span class="status-tag ${sClass}">${l.status}</span>${telatBadge}</td>
                <td><img src="${l.foto}" class="img-prev" onclick="zoomFoto('${l.foto}')"></td>
            </tr>`;
  });
  if (document.getElementById("countAbsen"))
    document.getElementById("countAbsen").innerText = count;
}

function renderKaryawanTable() {
  const body = document.getElementById("karyawanTableBody");
  if (!body) return;
  body.innerHTML = "";
  KARYAWAN.forEach((k, index) => {
    const d = hitungDetailGaji(k.gaji || 0, k.nama);
    body.innerHTML += `
            <tr>
                <td><strong>${k.nama}</strong><br><small>${k.nik || "-"}</small></td>
                <td>${k.jabatan || k.dept}<br><small>Hadir: ${d.hadir}/22</small></td>
                <td>Rp ${d.gapok.toLocaleString("id-ID")}</td>
                <td style="color:#15803d;font-weight:bold;">Rp ${d.thp.toLocaleString("id-ID")}</td>
                <td>
                    <button onclick="cetakSlip(${index})" style="color:#4f46e5; border:none; background:none; cursor:pointer; font-weight:bold;">SLIP</button> 
                    <button onclick="hapusKaryawan('${k.id}')" style="color:#ef4444; border:none; background:none; cursor:pointer;">HAPUS</button>
                </td>
            </tr>`;
  });
}

async function simpanKaryawan() {
  const nama = document.getElementById("inpNama").value.toUpperCase();
  const gaji = document.getElementById("inpGaji").value;
  const nik =
    document.getElementById("inpNik")?.value ||
    "KBI-" + Date.now().toString().slice(-6);

  if (!nama || !gaji) return alert("Isi Nama & Gaji!");

  const newKar = {
    nik,
    nama,
    dept: document.getElementById("inpDept").value,
    jabatan:
      document.getElementById("inpJabatan")?.value ||
      document.getElementById("inpDept").value,
    gaji: parseFloat(gaji),
  };

  const { error } = await supabaseClient.from("karyawan").insert([newKar]);
  if (!error) {
    alert("Karyawan ditambahkan!");
    hideModal();
    await syncData();
  } else {
    alert("Gagal menyimpan: " + error.message);
  }
}

async function hapusKaryawan(id) {
  if (confirm("Hapus data karyawan ini dari Cloud?")) {
    const { error } = await supabaseClient
      .from("karyawan")
      .delete()
      .eq("id", id);
    if (!error) await syncData();
    else alert("Gagal menghapus: " + error.message);
  }
}

// --- FITUR SLIP GAJI ---
function cetakSlip(index) {
  const k = KARYAWAN[index];
  const d = hitungDetailGaji(k.gaji, k.nama);
  const bulanIndo = [
    "JANUARI",
    "FEBRUARI",
    "MARET",
    "APRIL",
    "MEI",
    "JUNI",
    "JULI",
    "AGUSTUS",
    "SEPTEMBER",
    "OKTOBER",
    "NOVEMBER",
    "DESEMBER",
  ];
  const tgl = new Date();

  const isiSlip = `
    <div style="width: 450px; padding: 30px; border: 1px solid #000; font-family: 'Courier New', monospace; background: #fff;">
        <h2 style="text-align:center; margin:0;">PT. KOLA BORASI INDONESIA</h2>
        <p style="text-align:center; border-bottom: 2px solid #000; padding-bottom:10px;">SLIP GAJI - ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}</p>
        <div style="display:grid; grid-template-columns: 100px 10px 1fr; line-height: 1.5;">
            <span>NIK</span><span>:</span><span>${k.nik || "-"}</span>
            <span>NAMA</span><span>:</span><span>${k.nama}</span>
            <span>JABATAN</span><span>:</span><span>${k.jabatan || k.dept}</span>
            <span>HADIR</span><span>:</span><span style="font-weight:bold;">${d.hadir} / 22 Hari</span>
        </div>
        <div style="border-top:1px dashed #000; margin-top:10px; padding:10px 0;">
            <div style="display:flex; justify-content:space-between;"><span>Gaji Pokok</span><span>Rp ${d.gapok.toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; color:red; font-weight:bold;"><span>Gaji Pro-rata</span><span>Rp ${d.gajiPro.toLocaleString("id-ID")}</span></div>
        </div>
        <div style="border-top:1px dashed #000; padding:10px 0;">
            <div style="display:flex; justify-content:space-between; color:red;"><span>Potongan Telat</span><span>-Rp ${d.potonganTelat.toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>BPJS/Pajak</span><span>-Rp ${(d.totalPotongan - d.potonganTelat).toLocaleString("id-ID")}</span></div>
        </div>
        <div style="border-top:2px solid #000; padding:10px 0; display:flex; justify-content:space-between; font-weight:bold; font-size:1.1rem; background:#f0f0f0;">
            <span>TAKE HOME PAY</span><span>Rp ${d.thp.toLocaleString("id-ID")}</span>
        </div>
    </div>`;

  const w = window.open("", "_blank");
  w.document.write(
    `<html><body style="display:flex;justify-content:center;padding:20px;">${isiSlip}<script>window.onload=function(){window.print();window.close();}<\/script></body></html>`,
  );
  w.document.close();
}

// --- UTILITAS ---
function exportData() {
  let csv = "Nama,Departemen,Waktu,Status,Telat\n";
  logs.forEach(
    (l) =>
      (csv += `${l.nama},${l.dept},${new Date(l.waktu).toLocaleString("id-ID")},${l.status},${l.isLate}\n`),
  );
  const a = document.createElement("a");
  a.href = window.URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `Rekap_Absensi_KOBOI_${new Date().toLocaleDateString()}.csv`;
  a.click();
}

function zoomFoto(url) {
  const v = document.createElement("div");
  v.style =
    "position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;justify-content:center;align-items:center;z-index:9999;";
  v.onclick = () => v.remove();
  v.innerHTML = `<img src="${url}" style="max-width:90%; border: 3px solid white; border-radius:10px;">`;
  document.body.appendChild(v);
}

function loginAdmin() {
  if (prompt("Password Admin:") === "mautaubanget")
    window.location.href = "admin.html";
}

function showModal() {
  document.getElementById("modalKaryawan").style.display = "flex";
}
function hideModal() {
  document.getElementById("modalKaryawan").style.display = "none";
}
