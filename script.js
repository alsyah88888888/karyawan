/**
 * KOBOI PRESENSI - LOGIC CORE
 * Fitur: Absensi, Manajemen Karyawan, & Payroll Pro-rata Otomatis
 * PT. Kola Borasi Indonesia - Februari 2026
 */

// 1. DATABASE KARYAWAN (Data Riil sesuai Daftar Gaji 2026)
let KARYAWAN = JSON.parse(localStorage.getItem("koboi_karyawan")) || [
  {
    nik: "700231004622000",
    nama: "ANDIKA SEPTANU DWI AMWINANTO",
    dept: "FINANCE",
    jabatan: "ADMIN",
    gaji: 4300000,
  },
  {
    nik: "1207214909960003",
    nama: "KUSMAWANI",
    dept: "FINANCE",
    jabatan: "ADMIN",
    gaji: 7000000,
  },
  {
    nik: "659376610401000",
    nama: "DWI RISMAWAN",
    dept: "FINANCE",
    jabatan: "ADMIN",
    gaji: 4000000,
  },
  {
    nik: "3304052202930001",
    nama: "CAHYO ADI TRISNANTO",
    dept: "OPERASIONAL",
    jabatan: "KEPALA GUDANG",
    gaji: 8000000,
  },
  {
    nik: "3301091804890002",
    nama: "AHMAD RIYADI",
    dept: "OPERASIONAL",
    jabatan: "HELPER",
    gaji: 7260000,
  },
  {
    nik: "3201010409970002",
    nama: "RAHMAT HIDAYAT",
    dept: "OPERASIONAL",
    jabatan: "DRIVER",
    gaji: 7430000,
  },
  {
    nik: "3201011602800011",
    nama: "KARNO",
    dept: "OPERASIONAL",
    jabatan: "DRIVER",
    gaji: 6560000,
  },
  {
    nik: "3276053003920002",
    nama: "BUDI SASONGKO",
    dept: "OPERASIONAL",
    jabatan: "HELPER",
    gaji: 6000000,
  },
  {
    nik: "3201010404830009",
    nama: "HERU",
    dept: "OPERASIONAL",
    jabatan: "HELPER",
    gaji: 6000000,
  },
  {
    nik: "3201012602000001",
    nama: "IMAM MAHDI AMANULLAH GHAZI",
    dept: "OPERASIONAL",
    jabatan: "HELPER",
    gaji: 5000000,
  },
];

const OFFICE_IP = "103.108.130.34";
let logs = JSON.parse(localStorage.getItem("koboi_logs")) || [];

// --- INISIALISASI HALAMAN ---
window.onload = () => {
  const isUserPage = document.getElementById("namaSelect");
  const isAdminPage = document.getElementById("logTableBody");

  if (isUserPage) initUser();
  if (isAdminPage) {
    renderTabel();
    renderKaryawanTable();
  }
};

// --- LOGIKA PAYROLL OTOMATIS BERDASARKAN ABSENSI ---
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

// --- LOGIKA HALAMAN USER (INDEX) ---
async function initUser() {
  const sel = document.getElementById("namaSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Pilih Nama Anda --</option>';
  KARYAWAN.forEach((k) => {
    sel.innerHTML += `<option value="${k.nama}">${k.nama}</option>`;
  });

  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((s) => (document.getElementById("video").srcObject = s))
    .catch((err) => alert("Izin kamera ditolak!"));

  setInterval(() => {
    const clockEl = document.getElementById("liveClock");
    if (clockEl) clockEl.innerText = new Date().toLocaleTimeString("id-ID");
  }, 1000);

  const badge = document.getElementById("wifiStatus");
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    if (data.ip === OFFICE_IP) {
      badge.innerText = "Terhubung WiFi Kantor ✅";
      badge.className = "wifi-badge connected";
      document.getElementById("btnMasuk").disabled = false;
      document.getElementById("btnPulang").disabled = false;
    } else {
      badge.innerText = `Gunakan WiFi Kantor ❌ (${data.ip})`;
      badge.className = "wifi-badge disconnected";
      document.getElementById("btnMasuk").disabled = true;
      document.getElementById("btnPulang").disabled = true;
    }
  } catch (e) {
    if (badge) badge.innerText = "Gagal Verifikasi Jaringan";
  }
}

function prosesAbsen(tipe) {
  const nama = document.getElementById("namaSelect").value;
  if (!nama) return alert("Pilih Nama Anda!");

  const sekarang = new Date();
  const tglHariIni = sekarang.toLocaleDateString("id-ID");

  const sudahAbsen = logs.find(
    (l) => l.nama === nama && l.waktu.includes(tglHariIni) && l.status === tipe,
  );

  if (sudahAbsen) {
    return alert(
      `Anda SUDAH melakukan absen ${tipe} hari ini pada ${sudahAbsen.waktu.split(",")[1]}!`,
    );
  }

  let telat = false;
  if (tipe === "MASUK") {
    const jam = sekarang.getHours();
    const menit = sekarang.getMinutes();
    if (jam > 9 || (jam === 9 && menit > 0)) {
      telat = true;
    }
  }

  const v = document.getElementById("video");
  const c = document.getElementById("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);

  const info = KARYAWAN.find((k) => k.nama === nama);
  const newLog = {
    nama: info.nama,
    dept: info.dept,
    waktu: sekarang.toLocaleString("id-ID"),
    status: tipe,
    foto: c.toDataURL("image/webp", 0.5),
    isLate: telat,
  };

  logs.push(newLog);
  localStorage.setItem("koboi_logs", JSON.stringify(logs));

  if (telat) {
    alert(
      `Berhasil Absen MASUK!\nPERINGATAN: Anda terlambat, potongan 2% diterapkan.`,
    );
  } else {
    alert(`Berhasil Absen ${tipe}!`);
  }

  if (typeof renderTabel === "function") renderTabel();
}

// --- LOGIKA HALAMAN ADMIN ---

function switchTab(tab) {
  const tabLog = document.getElementById("tabLog");
  const tabKar = document.getElementById("tabKaryawan");
  const btnLog = document.getElementById("btnTabLog");
  const btnKar = document.getElementById("btnTabKaryawan");

  if (tab === "log") {
    tabLog.style.display = "block";
    tabKar.style.display = "none";
    btnLog.classList.add("nav-active");
    btnKar.classList.remove("nav-active");
    renderTabel();
  } else {
    tabLog.style.display = "none";
    tabKar.style.display = "block";
    btnKar.classList.add("nav-active");
    btnLog.classList.remove("nav-active");
    renderKaryawanTable();
  }
}

function renderTabel() {
  const body = document.getElementById("logTableBody");
  const filterEl = document.getElementById("filterDept");
  if (!body) return;

  const filter = filterEl ? filterEl.value : "ALL";
  body.innerHTML = "";
  let count = 0;

  logs.forEach((l) => {
    if (filter !== "ALL" && l.dept !== filter) return;
    count++;

    // LOGIKA BARU: Tampilkan badge merah jika data log memiliki isLate: true
    const sClass = l.status === "MASUK" ? "status-masuk" : "status-pulang";
    const telatBadge = l.isLate
      ? '<br><small style="color:red;font-weight:bold;">(TELAT)</small>'
      : "";

    body.innerHTML += `
            <tr>
                <td><strong>${l.nama}</strong></td>
                <td>${l.dept}</td>
                <td>${l.waktu}</td>
                <td><span class="status-tag ${sClass}">${l.status}</span>${telatBadge}</td>
                <td><img src="${l.foto}" class="img-prev" onclick="zoomFoto('${l.foto}')"></td>
            </tr>`;
  });
  const countEl = document.getElementById("countAbsen");
  if (countEl) countEl.innerText = count;
}

function renderKaryawanTable() {
  const body = document.getElementById("karyawanTableBody");
  if (!body) return;
  body.innerHTML = "";

  KARYAWAN.forEach((k, index) => {
    const d = hitungDetailGaji(k.gaji || 0, k.nama);
    body.innerHTML += `
            <tr>
                <td><strong>${k.nama}</strong><br><small style="color:#64748b">${k.nik || "-"}</small></td>
                <td>${k.jabatan || k.dept}<br><small>Hadir: ${d.hadir}/${d.standarHari}</small></td>
                <td>Rp ${d.gapok.toLocaleString("id-ID")}</td>
                <td style="color:#15803d; font-weight:bold;">Rp ${d.thp.toLocaleString("id-ID")}</td>
                <td>
                    <button onclick="cetakSlip(${index})" style="color:#4f46e5; border:none; background:none; cursor:pointer; font-weight:bold; margin-right:10px;">SLIP</button>
                    <button onclick="hapusKaryawan(${index})" style="color:#ef4444; border:none; background:none; cursor:pointer;">HAPUS</button>
                </td>
            </tr>`;
  });
}

function showModal() {
  document.getElementById("modalKaryawan").style.display = "flex";
}
function hideModal() {
  document.getElementById("modalKaryawan").style.display = "none";
}

function simpanKaryawan() {
  const nama = document.getElementById("inpNama").value.toUpperCase();
  const dept = document.getElementById("inpDept").value;
  const gaji = document.getElementById("inpGaji").value;
  const nik = document.getElementById("inpNik")
    ? document.getElementById("inpNik").value
    : "";
  const jabatan = document.getElementById("inpJabatan")
    ? document.getElementById("inpJabatan").value
    : dept;

  if (!nama || !gaji) return alert("Masukkan Nama dan Gaji!");

  KARYAWAN.push({ nik, nama, dept, jabatan, gaji: parseFloat(gaji) });
  localStorage.setItem("koboi_karyawan", JSON.stringify(KARYAWAN));

  alert("Karyawan Berhasil Ditambahkan!");
  document.getElementById("inpNama").value = "";
  document.getElementById("inpGaji").value = "";
  hideModal();
  renderKaryawanTable();
}

function hapusKaryawan(index) {
  if (confirm("Hapus karyawan ini?")) {
    KARYAWAN.splice(index, 1);
    localStorage.setItem("koboi_karyawan", JSON.stringify(KARYAWAN));
    renderKaryawanTable();
  }
}

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
  const tglSekarang = new Date();
  const bulanIni = bulanIndo[tglSekarang.getMonth()];
  const tahunIni = tglSekarang.getFullYear();

  const isiSlip = `
    <div style="width: 450px; padding: 30px; border: 1px solid #000; font-family: 'Courier New', monospace; color: #000; background: #fff;">
        <h2 style="text-align:center; margin-bottom:5px; margin-top:0;">PT. KOLA BORASI INDONESIA</h2>
        <p style="text-align:center; font-size:0.8rem; margin-bottom:15px; border-bottom: 2px solid #000; padding-bottom:10px;">SLIP GAJI - ${bulanIni} ${tahunIni}</p>
        
        <div style="display:grid; grid-template-columns: 100px 10px 1fr; font-size:0.9rem; margin-bottom:10px; line-height: 1.5;">
            <span>NIK</span><span>:</span><span>${k.nik || "-"}</span>
            <span>NAMA</span><span>:</span><span>${k.nama}</span>
            <span>JABATAN</span><span>:</span><span>${k.jabatan || k.dept}</span>
            <span>KEHADIRAN</span><span>:</span><span style="font-weight:bold;">${d.hadir} / ${d.standarHari} Hari</span>
        </div>

        <div style="border-top:1px dashed #000; padding:10px 0;">
            <div style="display:flex; justify-content:space-between;">
                <span>Gaji Pokok Full</span>
                <span>Rp ${d.gapok.toLocaleString("id-ID")}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; color:red;">
                <span>Gaji Pro-rata</span>
                <span>Rp ${d.gajiPro.toLocaleString("id-ID")}</span>
            </div>
        </div>

        <div style="border-top:1px dashed #000; padding:10px 0;">
            <div style="display:flex; justify-content:space-between; font-weight:bold;">
                <span>POTONGAN</span>
                <span></span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-top:5px; color: #b91c1c;">
                <span>Potongan Telat (${d.jumlahTelat}x)</span>
                <span>-Rp ${d.potonganTelat.toLocaleString("id-ID")}</span>
            </div>
            
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-top:5px;">
                <span>BPJS Kesehatan (1%)</span>
                <span>-Rp ${d.bpjsKes.toLocaleString("id-ID")}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
                <span>JHT (2%)</span>
                <span>-Rp ${d.jht.toLocaleString("id-ID")}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
                <span>JP (1%)</span>
                <span>-Rp ${d.jp.toLocaleString("id-ID")}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
                <span>PPh 21 (1.5%)</span>
                <span>-Rp ${d.pph21.toLocaleString("id-ID")}</span>
            </div>
        </div>

        <div style="border-top:2px solid #000; margin-top:10px; padding:10px 0; display:flex; justify-content:space-between; font-weight:bold; font-size:1.1rem; background:#f0f0f0;">
            <span>TAKE HOME PAY</span>
            <span>Rp ${d.thp.toLocaleString("id-ID")}</span>
        </div>
        
        <p style="text-align:center; font-size:0.7rem; margin-top:20px; font-style:italic;">Dicetak melalui KOBOI Apps pada ${tglSekarang.toLocaleString("id-ID")}</p>
    </div>`;

  const modalHTML = `
    <div id="slipModal" style="position:fixed; inset:0; background:rgba(0,0,0,0.8); display:flex; align-items:center; justify-content:center; z-index:10000; padding:20px;">
        <div style="background:white; padding:20px; border-radius:15px; text-align:center;">
            <div id="captureArea">${isiSlip}</div>
            <div style="display:flex; gap:10px; margin-top:20px;">
                <button id="btnActionPrint" style="flex:1; padding:12px; background:#10b981; color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">CETAK PDF</button>
                <button onclick="document.getElementById('slipModal').remove()" style="flex:1; padding:12px; background:#4f46e5; color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">TUTUP</button>
            </div>
        </div>
    </div>`;

  document.body.insertAdjacentHTML("beforeend", modalHTML);

  document.getElementById("btnActionPrint").onclick = function () {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
        <head><title>Slip Gaji - ${k.nama}</title></head>
        <body style="display:flex; justify-content:center; padding-top:20px;">
          ${isiSlip}
          <script>
            window.onload = function() { 
                window.print(); 
                setTimeout(function(){ window.close(); }, 100); 
            }
          <\/script>
        </body>
      </html>`);
    printWindow.document.close();
  };
}

// Utilitas Admin
function loginAdmin() {
  if (prompt("Masukkan Password Admin:") === "mautaubanget") {
    window.location.href = "admin.html";
  }
}

function exportData() {
  let csv = "Nama,Departemen,Waktu,Status\n";
  logs.forEach((l) => (csv += `${l.nama},${l.dept},${l.waktu},${l.status}\n`));
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Rekap_Absensi_KOBOI.csv`;
  a.click();
}

function clearData() {
  if (confirm("Hapus semua log?")) {
    localStorage.removeItem("koboi_logs");
    logs = [];
    renderTabel();
  }
}

function zoomFoto(url) {
  const viewer = document.createElement("div");
  viewer.style =
    "position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;cursor:pointer;";
  viewer.onclick = () => viewer.remove();
  viewer.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; border-radius:15px; border: 3px solid white;">`;
  document.body.appendChild(viewer);
}
