/**
 * KOBOI PRESENSI - FULL CLOUD VERSION (REVISED)
 * Fitur: Cloud Sync, Absensi, Manajemen Karyawan, & Payroll PDF
 * PT. Kola Borasi Indonesia - Februari 2026
 */

// 1. KONFIGURASI SUPABASE
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

const OFFICE_IP = "124.158.189.237";
let KARYAWAN = [];
let logs = [];

// --- FUNGSI CLOUD SYNC ---
async function syncData() {
  try {
    console.log("Mengambil data dari Cloud...");

    // Ambil Data Karyawan
    const { data: dataKar, error: errKar } = await supabaseClient
      .from("karyawan")
      .select("*")
      .order("nama", { ascending: true });

    if (errKar) throw errKar;
    KARYAWAN = dataKar || []; // Mengisi variabel kapital

    // Ambil Data Logs
    const { data: dataLog, error: errLog } = await supabaseClient
      .from("logs")
      .select("*")
      .order("id", { ascending: false });

    if (errLog) throw errLog;
    logs = dataLog || [];

    // WAJIB: Panggil fungsi render setelah data masuk
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

  // Filter log untuk karyawan spesifik
  const dataLogKaryawan = logs.filter((l) => l.nama === namaKaryawan);

  // Hitung hadir unik berdasarkan tanggal (hanya status MASUK)
  const hariHadir = [
    ...new Set(
      dataLogKaryawan
        .filter((l) => l.status === "MASUK")
        .map((l) => new Date(l.waktu).toLocaleDateString()),
    ),
  ].length;

  // Hitung jumlah telat (proteksi jika kolom isLate/is_late berbeda)
  const jumlahTelat = dataLogKaryawan.filter(
    (l) => l.status === "MASUK" && (l.isLate === true || l.is_late === true),
  ).length;

  // RUMUS PERHITUNGAN
  const gajiPro = (hariHadir / standarHari) * g;
  const potonganTelat = jumlahTelat * (gajiHarian * 0.02); // Potongan 2% dari gaji harian per telat

  // Potongan Statis (Total 5.5% dari gaji pro-rata)
  const bpjsKes = gajiPro * 0.01;
  const jht = gajiPro * 0.02;
  const jp = gajiPro * 0.01;
  const pph21 = gajiPro * 0.015;

  const totalPotongan = bpjsKes + jht + jp + pph21 + potonganTelat;
  const thp = gajiPro - totalPotongan;

  return {
    gapok: g,
    gajiPro,
    hadir: hariHadir,
    jumlahTelat,
    potonganTelat,
    bpjsKes,
    jht,
    jp,
    pph21,
    totalPotongan,
    thp: thp > 0 ? thp : 0,
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

  const sudahAbsen = logs.find(
    (l) =>
      l.nama === nama &&
      new Date(l.waktu).toLocaleDateString("id-ID") === tglHariIni &&
      l.status === tipe,
  );
  if (sudahAbsen) return alert(`Anda SUDAH absen ${tipe} hari ini!`);

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
    waktu: sekarang.toISOString(),
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
        ? "Berhasil! Anda telat."
        : "Berhasil! Selamat Bekerja.",
    );
    await syncData();
  }
}

// --- LOGIKA ADMIN ---
function switchTab(tab) {
  // 1. Sembunyikan semua konten tab
  document.getElementById("tabLog").style.display = "none";
  document.getElementById("tabKaryawan").style.display = "none";

  // 2. Logika untuk memunculkan tab dan mengisi data
  if (tab === "log") {
    document.getElementById("tabLog").style.display = "block";
    renderTabel(); // Fungsi gambar tabel log
  } else if (tab === "karyawan") {
    // Sesuaikan dengan isi onclick di HTML
    document.getElementById("tabKaryawan").style.display = "block";
    renderKaryawanTable(); // Fungsi gambar tabel karyawan
  }

  // 3. Update warna tombol aktif
  document
    .getElementById("btnTabLog")
    .classList.toggle("nav-active", tab === "log");
  document
    .getElementById("btnTabKaryawan")
    .classList.toggle("nav-active", tab === "karyawan");
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

    // PERBAIKAN: Menambahkan tombol hapus di kolom terakhir
    body.innerHTML += `
            <tr>
                <td><strong>${l.nama}</strong></td>
                <td>${l.dept}</td>
                <td>${waktuTampil}</td>
                <td><span class="status-tag ${sClass}">${l.status}</span>${telatBadge}</td>
                <td>
                    <img src="${l.foto}" class="img-prev" onclick="zoomFoto('${l.foto}')" style="cursor:pointer;">
                    <button onclick="hapusSatuLog(${l.id})" style="display:block; margin-top:5px; color:#ef4444; border:none; background:none; cursor:pointer; font-size:0.7rem; font-weight:bold;">[HAPUS LOG]</button>
                </td>
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
        <td>Rp ${(k.gaji || 0).toLocaleString("id-ID")}</td>
        <td style="color:#15803d; font-weight:bold;">Rp ${Math.floor(d.thp).toLocaleString("id-ID")}</td>
        <td>
          <button onclick="cetakSlip(${index})" style="color:#4f46e5; border:none; background:none; cursor:pointer; font-weight:bold;">SLIP</button>
          <button onclick="downloadSlip(${index})" style="color:#10b981; border:none; background:none; cursor:pointer; font-weight:bold; margin-left:10px;">DOWNLOAD</button> 
          <button onclick="hapusKaryawan('${k.id}')" style="color:#ef4444; border:none; background:none; cursor:pointer; margin-left:10px;">HAPUS</button>
        </td>
      </tr>`;
  });
}

function downloadSlip(index) {
  const k = KARYAWAN[index];
  const d = hitungDetailGaji(k.gaji, k.nama);
  const tgl = new Date();
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
  const namaFile = `Slip_Gaji_${k.nama}_${bulanIndo[tgl.getMonth()]}_${tgl.getFullYear()}.pdf`;

  const isiSlip = `
    <div style="width: 450px; padding: 30px; border: 1px solid #000; font-family: 'Courier New', monospace; background: #fff; color: #000;">
        <h2 style="text-align:center; margin:0;">PT. KOLA BORASI INDONESIA</h2>
        <p style="text-align:center; border-bottom: 2px solid #000; padding-bottom:10px; font-weight:bold;">SLIP GAJI - ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}</p>
        
        <div style="display:grid; grid-template-columns: 120px 10px 1fr; line-height: 1.6;">
            <span>NIK</span><span>:</span><span>${k.nik || "-"}</span>
            <span>NAMA</span><span>:</span><span>${k.nama}</span>
            <span>JABATAN</span><span>:</span><span>${k.jabatan || k.dept}</span>
            <span>KEHADIRAN</span><span>:</span><span>${d.hadir} / 22 Hari</span>
        </div>

        <div style="border-top:1px dashed #000; margin-top:15px; padding-top:10px;">
            <div style="display:flex; justify-content:space-between;"><span>Gaji Pokok Full</span><span>Rp ${d.gapok.toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold;"><span>Gaji Pro-rata</span><span>Rp ${Math.floor(d.gajiPro).toLocaleString("id-ID")}</span></div>
        </div>

        <p style="margin: 10px 0 5px 0; font-weight:bold; text-decoration: underline;">POTONGAN</p>
        <div style="line-height: 1.4;">
            <div style="display:flex; justify-content:space-between;"><span>BPJS Kesehatan (1%)</span><span>-Rp ${Math.floor(d.bpjsKes).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>JHT (2%)</span><span>-Rp ${Math.floor(d.jht).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>JP (1%)</span><span>-Rp ${Math.floor(d.jp).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>PPh 21 (1.5%)</span><span>-Rp ${Math.floor(d.pph21).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; color: red;"><span>Potongan Telat (${d.jumlahTelat}x)</span><span>-Rp ${Math.floor(d.potonganTelat).toLocaleString("id-ID")}</span></div>
        </div>

        <div style="border-top:2px solid #000; margin-top:15px; padding:10px 0; display:flex; justify-content:space-between; font-weight:bold; font-size:1.1rem; background:#f9f9f9;">
            <span>TAKE HOME PAY</span><span>Rp ${Math.floor(d.thp).toLocaleString("id-ID")}</span>
        </div>
        
        <p style="text-align:center; font-size:0.7rem; margin-top:20px; font-style: italic;">Dicetak melalui KOBOI Apps pada ${tgl.toLocaleString("id-ID")}</p>
    </div>`;

  // Membuat jendela baru untuk proses download/print
  const w = window.open("", "_blank");
  w.document.write(`
        <html>
            <head><title>${namaFile}</title></head>
            <body style="display:flex;justify-content:center;padding:20px;">
                ${isiSlip}
                <script>
                    window.onload = function() {
                        window.print();
                        // Menutup jendela otomatis setelah dialog print selesai (opsional)
                        // window.close(); 
                    }
                <\/script>
            </body>
        </html>
    `);
  w.document.close();
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
  const tgl = new Date();
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

  const isiSlip = `
    <div style="width: 450px; padding: 30px; border: 1px solid #000; font-family: 'Courier New', monospace; background: #fff; color: #000;">
        <h2 style="text-align:center; margin:0;">PT. KOLA BORASI INDONESIA</h2>
        <p style="text-align:center; border-bottom: 2px solid #000; padding-bottom:10px; font-weight:bold;">SLIP GAJI - ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}</p>
        
        <div style="display:grid; grid-template-columns: 120px 10px 1fr; line-height: 1.6;">
            <span>NIK</span><span>:</span><span>${k.nik || "-"}</span>
            <span>NAMA</span><span>:</span><span>${k.nama}</span>
            <span>JABATAN</span><span>:</span><span>${k.jabatan || k.dept}</span>
            <span>KEHADIRAN</span><span>:</span><span>${d.hadir} / 22 Hari</span>
        </div>

        <div style="border-top:1px dashed #000; margin-top:15px; padding-top:10px;">
            <div style="display:flex; justify-content:space-between;"><span>Gaji Pokok Full</span><span>Rp ${d.gapok.toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold;"><span>Gaji Pro-rata</span><span>Rp ${Math.floor(d.gajiPro).toLocaleString("id-ID")}</span></div>
        </div>

        <p style="margin: 10px 0 5px 0; font-weight:bold; text-decoration: underline;">POTONGAN</p>
        <div style="line-height: 1.4;">
            <div style="display:flex; justify-content:space-between;"><span>BPJS Kesehatan (1%)</span><span>-Rp ${Math.floor(d.bpjsKes).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>JHT (2%)</span><span>-Rp ${Math.floor(d.jht).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>JP (1%)</span><span>-Rp ${Math.floor(d.jp).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>PPh 21 (1.5%)</span><span>-Rp ${Math.floor(d.pph21).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; color: red;"><span>Potongan Telat (${d.jumlahTelat}x)</span><span>-Rp ${Math.floor(d.potonganTelat).toLocaleString("id-ID")}</span></div>
        </div>

        <div style="border-top:2px solid #000; margin-top:15px; padding:10px 0; display:flex; justify-content:space-between; font-weight:bold; font-size:1.1rem; background:#f9f9f9;">
            <span>TAKE HOME PAY</span><span>Rp ${Math.floor(d.thp).toLocaleString("id-ID")}</span>
        </div>
        
        <p style="text-align:center; font-size:0.7rem; margin-top:20px; font-style: italic;">Dicetak melalui KOBOI Apps pada ${tgl.toLocaleString("id-ID")}</p>
    </div>`;

  const w = window.open("", "_blank");
  w.document.write(
    `<html><body style="display:flex;justify-content:center;padding:20px;">${isiSlip}</body></html>`,
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
    "position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;justify-content:center;align-items:center;z-index:9999;cursor:pointer;";
  v.onclick = () => v.remove();
  v.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; border: 3px solid white; border-radius:10px;">`;
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

// --- FITUR HAPUS LOG (CLOUD VERSION) ---

// 1. Hapus SEMUA Log (Tombol Clear All)
async function clearData() {
  if (
    confirm(
      "PERINGATAN! Anda akan menghapus SELURUH data absensi di Cloud. Lanjutkan?",
    )
  ) {
    const { error } = await supabaseClient.from("logs").delete().neq("id", 0); // Trik SQL untuk menghapus semua baris

    if (!error) {
      alert("Seluruh log berhasil dihapus!");
      await syncData(); // Segarkan tampilan
    } else {
      alert("Gagal menghapus: " + error.message);
    }
  }
}

// 2. Hapus Satu Baris Log (Opsional, jika Anda ingin menambah tombol hapus di tiap baris)
async function hapusSatuLog(id) {
  if (confirm("Hapus data absensi ini dari Cloud?")) {
    const { error } = await supabaseClient.from("logs").delete().eq("id", id);

    if (!error) {
      alert("Log berhasil dihapus!");
      await syncData(); // Segarkan data dan tabel
    } else {
      alert("Gagal menghapus: " + error.message);
    }
  }
}
