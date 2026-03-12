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

const OFFICE_IP = "103.108.130.44";
let KARYAWAN = [];
let logs = [];
let cutiData = [];
let kasbonData = [];
let isOfficeGlobal = false;
let clockClicks = 0;
let lastClickTime = 0;

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

    // Ambil Data Cuti
    const { data: dataCuti, error: errCuti } = await supabaseClient.from("cuti_izin").select("*").order("id", { ascending: false });
    if (errCuti) throw errCuti;
    cutiData = dataCuti || [];

    // Ambil Data Kasbon
    const { data: dataKasbon, error: errKasbon } = await supabaseClient.from("kasbon").select("*").order("id", { ascending: false });
    if (errKasbon) throw errKasbon;
    kasbonData = dataKasbon || [];

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

    // Tambahkan event listener untuk kontrol tombol Driver
    if (!sel.hasAttribute('data-listener')) {
      sel.setAttribute('data-listener', 'true');
      sel.addEventListener('change', toggleDriverButtons);
    }
    toggleDriverButtons(); // Cek saat render pertama
  }

  if (isAdminPage) {
    renderTabel();
    renderKaryawanTable();
    renderAkunTable();
    updateBadges();
  }
}

function toggleDriverButtons() {
  const sel = document.getElementById("namaSelect");
  const btnMasuk = document.getElementById("btnMasuk");
  if (!sel || !btnMasuk) return;

  const nama = sel.value;
  const info = KARYAWAN.find(k => k.nama === nama);
  const hasUser = nama !== "";

  // Reset Default
  btnMasuk.innerText = "MASUK";
  btnMasuk.setAttribute("onclick", "prosesAbsen('MASUK')");

  // Perlakuan Khusus Driver / Helper
  if (info && (info.dept === "OPERASIONAL" && (info.jabatan === "DRIVER" || info.jabatan === "Helper"))) {
    btnMasuk.innerText = "BERANGKAT";
    btnMasuk.setAttribute("onclick", "prosesAbsen('BERANGKAT')");
  }

  // Aktifkan tombol berdasarkan seleksi user
  const basicButtons = ["btnMasuk", "btnPulang"];
  basicButtons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasUser;
  });
}

// --- INISIALISASI ---
window.onload = async () => {
  await syncData();
  if (document.getElementById("namaSelect")) initUser();
};

// --- LOGIKA PAYROLL ---
function hitungDetailGaji(gapok, logsData, kasbonData, nikKaryawan) {
  const g = parseFloat(gapok) || 0;
  const standarHari = 22;
  const gajiHarian = g / standarHari;

  const info = KARYAWAN.find(k => k.nik === nikKaryawan);
  const ptkpStatus = info?.status_ptkp || "TK/0";

  // Group logs by Date for Overtime
  const logsByDate = {};
  logsData.forEach(l => {
    const d = new Date(l.waktu).toLocaleDateString();
    if (!logsByDate[d]) logsByDate[d] = [];
    logsByDate[d].push(l);
  });

  let totalLemburRp = 0;
  let totalJamLembur = 0;
  const uniqueDates = Object.keys(logsByDate);
  const hariHadir = uniqueDates.filter(d =>
    logsByDate[d].some(l => l.status === "MASUK" || l.status === "BERANGKAT")
  ).length;

  uniqueDates.forEach(date => {
    const dayLogs = logsByDate[date].sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
    const firstIn = dayLogs.find(l => l.status === "MASUK" || l.status === "BERANGKAT");
    const lastOut = [...dayLogs].reverse().find(l => l.status === "PULANG");

    if (firstIn && lastOut) {
      const hours = (new Date(lastOut.waktu) - new Date(firstIn.waktu)) / (1000 * 3600);
      if (hours > 9) {
        const overtime = Math.floor(hours - 9);
        totalJamLembur += overtime;
        totalLemburRp += overtime * 10000;
      }
    }
  });

  const jumlahTelat = logsData.filter(
    (l) => (l.status === "MASUK" || l.status === "BERANGKAT") && (l.isLate === true || l.is_late === true),
  ).length;

  const totalKasbon = kasbonData
    ? kasbonData.filter(k => k.status === 'APPROVED').reduce((sum, k) => sum + parseFloat(k.nominal), 0)
    : 0;

  const gajiPro = (hariHadir / standarHari) * g;
  const potonganTelat = jumlahTelat * (gajiHarian * 0.02);

  const bpjsKes = gajiPro * 0.01;
  const jht = gajiPro * 0.02;
  const jp = gajiPro * 0.01;

  const ptkpMap = {
    "TK/0": 54000000, "TK/1": 58500000, "TK/2": 63000000, "TK/3": 67500000,
    "K/0": 58500000, "K/1": 63000000, "K/2": 67500000, "K/3": 72000000
  };
  const ptkpTahunan = ptkpMap[ptkpStatus] || 54000000;
  const ptkpBulanan = ptkpTahunan / 12;

  const brutoNeto = gajiPro - (bpjsKes + jht + jp);
  const pkpBulanan = brutoNeto - ptkpBulanan;

  let pph21 = 0;
  if (pkpBulanan > 0) {
    pph21 = pkpBulanan * 0.05;
  }

  const totalPotongan = bpjsKes + jht + jp + pph21 + potonganTelat + totalKasbon;
  const thp = (gajiPro + totalLemburRp) - totalPotongan;

  return {
    gapok: g, gajiPro, hariHadir, hadir: hariHadir, jumlahTelat, potonganTelat,
    bpjsKes, jht, jp, pph21, kasbon: totalKasbon, bonusLembur: totalLemburRp,
    jamLembur: totalJamLembur, totalPotongan,
    thp: thp > 0 ? thp : 0, ptkpStatus, ptkpBulanan
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
    if (clockEl) {
      clockEl.innerText = new Date().toLocaleTimeString("id-ID");

      // Hidden trigger: Click clock 5 times in 3s
      if (!clockEl.hasAttribute('data-trigger')) {
        clockEl.setAttribute('data-trigger', 'true');
        clockEl.style.cursor = "pointer";
        clockEl.addEventListener('click', () => {
          const now = Date.now();
          if (now - lastClickTime > 3000) clockClicks = 0;
          clockClicks++;
          lastClickTime = now;
          if (clockClicks >= 5) {
            clockClicks = 0;
            loginAdmin();
          }
        });
      }
    }
  }, 1000);

  const badge = document.getElementById("wifiStatus");
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    isOfficeGlobal = data.ip === OFFICE_IP;
    badge.innerText = isOfficeGlobal
      ? "Terhubung WiFi Kantor ✅"
      : `Gunakan WiFi Kantor ❌ (${data.ip})`;
    badge.className = isOfficeGlobal
      ? "wifi-badge connected"
      : "wifi-badge disconnected";

    // Sinkronkan status tombol pertama kali
    toggleDriverButtons();
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
  if (tipe === "MASUK" || tipe === "BERANGKAT") {
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
    let pesen = "";
    if (tipe === "MASUK" || tipe === "BERANGKAT") {
      if (telat) {
        pesen = "Jangan diulangi, yuk lebih semangat lagi berangkatnya biar tidak terlambat";
      } else {
        pesen = "Berhasil Jangan lupa Do'a dahulu sebelum bekerja, Semangat!!!";
      }
    } else {
      // Untuk PULANG
      pesen = "Terima Kasih semoga pencapaian harianmu berhasil dan tetap semangat sampai jumpa lagi";
    }

    alert(pesen);
    await syncData();
  }
}

// --- LOGIKA ADMIN ---
function switchTab(tab) {
  // 1. Sembunyikan semua konten tab
  document.getElementById("tabLog").style.display = "none";
  document.getElementById("tabKaryawan").style.display = "none";
  document.getElementById("tabCuti").style.display = "none";
  document.getElementById("tabKasbon").style.display = "none";
  document.getElementById("tabAkun").style.display = "none";

  // 2. Logika untuk memunculkan tab dan mengisi data
  if (tab === "log") {
    document.getElementById("tabLog").style.display = "flex";
    renderTabel();
  } else if (tab === "karyawan") {
    document.getElementById("tabKaryawan").style.display = "flex";
    renderKaryawanTable();
  } else if (tab === "cuti") {
    document.getElementById("tabCuti").style.display = "flex";
    renderCutiTable();
  } else if (tab === "kasbon") {
    document.getElementById("tabKasbon").style.display = "flex";
    renderKasbonTable();
  } else if (tab === "akun") {
    document.getElementById("tabAkun").style.display = "flex";
    renderAkunTable();
  }

  // 3. Update warna tombol aktif
  document.getElementById("btnTabLog").classList.toggle("nav-active", tab === "log");
  document.getElementById("btnTabKaryawan").classList.toggle("nav-active", tab === "karyawan");
  document.getElementById("btnTabCuti").classList.toggle("nav-active", tab === "cuti");
  document.getElementById("btnTabKasbon").classList.toggle("nav-active", tab === "kasbon");
  document.getElementById("btnTabAkun").classList.toggle("nav-active", tab === "akun");
}

function updateBadges() {
  const pendingCuti = cutiData.filter(c => c.status === 'PENDING').length;
  const pendingKasbon = kasbonData.filter(k => k.status === 'PENDING').length;

  const badgeCuti = document.getElementById("badgeCuti");
  const badgeKasbon = document.getElementById("badgeKasbon");

  if (badgeCuti) {
    badgeCuti.innerText = pendingCuti;
    badgeCuti.style.display = pendingCuti > 0 ? "inline-block" : "none";
  }
  if (badgeKasbon) {
    badgeKasbon.innerText = pendingKasbon;
    badgeKasbon.style.display = pendingKasbon > 0 ? "inline-block" : "none";
  }
}

function renderTabel() {
  const body = document.getElementById("logTableBody");
  if (!body) return;
  const filter = document.getElementById("filterDept")?.value || "ALL";
  body.innerHTML = "";
  let count = 0;

  logs.forEach((l) => {
    // Ambil data karyawan terbaru dari master KARYAWAN
    const info = KARYAWAN.find(k => k.nama === l.nama);
    // Jika data profil karyawan masih ada, kita gunakan department terbarunya. 
    // Kalau karyawan sudah dihapus seluruhnya, ambil string dari `l.dept` lawas/aslinya.
    const deptTerkini = info ? info.dept : l.dept;

    // Filter berdasarkan Departemen yang TERKINI, bukan riwayat log
    if (filter !== "ALL" && deptTerkini !== filter) return;

    count++;

    const displayID = info && info.nik ? `<br><small>${info.nik}</small>` : "";

    const sClass = (l.status === "MASUK" || l.status === "BERANGKAT") ? "status-masuk" : "status-pulang";
    const waktuTampil = l.waktu ? new Date(l.waktu).toLocaleString("id-ID") : "-";
    const telatBadge = l.isLate
      ? '<br><small style="color:red;font-weight:bold;">(TELAT)</small>'
      : "";

    // PERBAIKAN: Gunakan deptTerkini saat memunculkan di kolom Departemen
    body.innerHTML += `
            <tr>
                <td><strong>${l.nama}</strong>${displayID}</td>
                <td>${deptTerkini}</td>
                <td>${waktuTampil}</td>
                <td><span class="status-tag ${sClass}">${l.status}</span>${telatBadge}</td>
                <td>
                    <img src="${l.foto}" class="img-prev" onclick="zoomFoto('${l.foto}')" style="cursor:pointer;">
                    <button onclick="hapusSatuLog('${l.waktu}')" style="display:block; margin-top:5px; color:var(--danger); border:none; background:none; cursor:pointer; font-size:0.7rem; font-weight:bold;">[HAPUS LOG]</button>
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
    const userLogs = logs.filter(l => l.nama === k.nama).slice(0, 30);
    const userKasbon = kasbonData.filter(kb => kb.nama === k.nama);
    const d = hitungDetailGaji(k.gaji || 0, userLogs, userKasbon, k.nik);
    body.innerHTML += `
      <tr style="font-size: 0.85rem;">
        <td>
          <div style="font-weight:800; line-height:1.1;">${k.nama}</div>
          <div style="font-size:0.65rem; color:var(--text-muted);">NIK: ${k.nik || "-"} | TTD: ${k.mou_signed ? '✅' : '⏳'}</div>
        </td>
        <td>
          <div style="font-weight:600; line-height:1.1;">${k.dept}</div>
          <div style="font-size:0.65rem; color:var(--text-muted);">${k.jabatan || "-"}</div>
        </td>
        <td style="text-align:center;">
          <div style="font-weight:600;">${d.hadir}</div>
          <div style="font-size:0.65rem; color:var(--text-muted);">Hari</div>
        </td>
        <td>
          <div style="font-weight:600; line-height:1.1;">Rp ${(k.gaji || 0).toLocaleString('id-ID')}</div>
          <div style="font-size:0.65rem; color:var(--text-muted);">Mulai: ${k.tahun_bergabung || "-"}</div>
        </td>
        <td style="color:var(--accent); font-weight:800;">
          Rp ${Math.floor(d.thp).toLocaleString("id-ID")}
          <div style="font-size:0.65rem; color:var(--text-muted); font-weight:normal;">PTKP: ${k.status_ptkp || "-"}</div>
        </td>
        <td style="font-size: 0.65rem; color:var(--text-muted); line-height:1.1; max-width:120px;">
          KTP: ${k.nik_ktp || "-"}<br>NPWP: ${k.npwp || "-"}
        </td>
        <td>
          <div style="display:flex; gap:3px;">
            <button onclick="cetakSlip(${index})" class="status-tag status-masuk" style="border:none; cursor:pointer; font-size:0.6rem; padding:3px 6px;">PDF</button>
            <button onclick="kirimWaSlip(${index})" class="status-tag" style="background:#dcfce7; color:#15803d; border:none; cursor:pointer; font-size:0.6rem; padding:3px 6px;">WA</button>
            <button onclick="adminCetakMOU(${index})" class="status-tag status-pulang" style="border:none; cursor:pointer; font-size:0.6rem; padding:3px 6px;">MOU</button>
          </div>
        </td>
      </tr>`;
  });
}



async function simpanKaryawan() {
  try {
    const namaEl = document.getElementById("inpNama");
    const gajiEl = document.getElementById("inpGaji");
    const deptEl = document.getElementById("inpDept");
    const nikEl = document.getElementById("inpNik");
    const jabEl = document.getElementById("inpJabatan");
    const pinEl = document.getElementById("inpPin");
    const cutiEl = document.getElementById("inpCuti");

    if (!namaEl || !gajiEl || !deptEl) {
      console.error("Elemen form tidak ditemukan!");
      return alert("Terjadi kesalahan sistem: Elemen form tidak ditemukan.");
    }

    const nama = namaEl.value.trim().toUpperCase();
    const gaji = gajiEl.value;
    const dept = deptEl.value;
    const nik = nikEl?.value.trim() || "KBI-" + Math.floor(100000 + Math.random() * 900000);
    const jabatan = jabEl?.value.trim() || dept;
    const tahun = document.getElementById("inpTahun")?.value.trim() || "";
    const pin = pinEl ? pinEl.value.trim() : "";
    const nomor_wa = document.getElementById("inpWa")?.value.trim() || "";
    const sisa_cuti = cutiEl ? parseInt(cutiEl.value) || 12 : 12;

    const nik_ktp = document.getElementById("inpNikKtp")?.value.trim() || "";
    const npwp = document.getElementById("inpNpwp")?.value.trim() || "";
    const status_ptkp = document.getElementById("inpPtkp")?.value || "";

    if (!nama || !gaji) {
      return alert("Mohon isi Nama dan Gaji!");
    }

    const nominalGaji = parseFloat(gaji);
    if (isNaN(nominalGaji)) {
      return alert("Gaji harus berupa angka!");
    }

    const newKar = {
      nik,
      nama,
      dept,
      jabatan,
      gaji: nominalGaji,
      tahun_bergabung: tahun,
      pin,
      nomor_wa,
      sisa_cuti,
      nik_ktp,
      npwp,
      status_ptkp
    };

    console.log("Menyimpan karyawan baru:", newKar);

    const { error } = await supabaseClient.from("karyawan").insert([newKar]);

    if (error) throw error;

    console.log("Karyawan berhasil disimpan");
    alert("Karyawan berhasil ditambahkan!");
    hideModal();

    // Reset Form
    namaEl.value = "";
    gajiEl.value = "";
    if (nikEl) nikEl.value = "";
    if (jabEl) jabEl.value = "";
    if (document.getElementById("inpTahun")) document.getElementById("inpTahun").value = "";
    if (pinEl) pinEl.value = "";
    if (document.getElementById("inpWa")) document.getElementById("inpWa").value = "";
    if (cutiEl) cutiEl.value = "12";
    if (document.getElementById("inpNikKtp")) document.getElementById("inpNikKtp").value = "";
    if (document.getElementById("inpNpwp")) document.getElementById("inpNpwp").value = "";
    if (document.getElementById("inpPtkp")) document.getElementById("inpPtkp").value = "TK/0";

    await syncData();
  } catch (err) {
    console.error("Gagal simpan karyawan:", err);
    alert("Gagal menyimpan ke database: " + (err.message || "Unknown Error"));
  }
}

// FITUR EDIT KARYAWAN
function showEditModal(index) {
  const k = KARYAWAN[index];
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal("editOriginalNik", k.nik);
  setVal("editNik", k.nik);
  setVal("editNama", k.nama);
  setVal("editDept", k.dept);
  setVal("editJabatan", k.jabatan || "");
  setVal("editGaji", k.gaji || 0);
  setVal("editTahun", k.tahun_bergabung || ""); // Terjaga oleh setVal
  setVal("editPin", k.pin || "");
  setVal("editCuti", k.sisa_cuti ?? 12);
  setVal("editNikKtp", k.nik_ktp || "");
  setVal("editNpwp", k.npwp || "");
  setVal("editWa", k.nomor_wa || "");
  setVal("editPtkp", k.status_ptkp || "TK/0");

  console.log("Loading Edit Modal for:", k);
  const modal = document.getElementById("modalEdit");
  if (modal) modal.classList.add("active");
  else console.error("Modal Edit not found!");
}

function hideEditModal() {
  document.getElementById("modalEdit").classList.remove("active");
}

async function updateKaryawan() {
  try {
    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };

    const originalNik = getVal("editOriginalNik");
    const nik = getVal("editNik");
    const nama = getVal("editNama").toUpperCase();
    const dept = document.getElementById("editDept")?.value || "";
    const jabatan = getVal("editJabatan") || dept;
    const gaji = parseFloat(getVal("editGaji")) || 0;
    const tahun = getVal("editTahun");
    const pin = getVal("editPin");
    const sisa_cuti = parseInt(getVal("editCuti")) || 0;

    const nik_ktp = getVal("editNikKtp");
    const npwp = getVal("editNpwp");
    const nomor_wa = getVal("editWa");
    const status_ptkp = document.getElementById("editPtkp")?.value || "";

    if (!nama || !gaji) return alert("Nama dan Gaji tidak boleh kosong!");

    const updatedData = {
      nik,
      nama,
      dept,
      jabatan,
      gaji,
      tahun_bergabung: tahun,
      pin,
      sisa_cuti,
      nik_ktp,
      npwp,
      nomor_wa,
      status_ptkp
    };

    const { error } = await supabaseClient
      .from("karyawan")
      .update(updatedData)
      .eq("nik", originalNik);

    if (error) throw error;

    alert("Data berhasil diperbarui!");
    hideEditModal();

    // Refresh local KARYAWAN array immediately to reflect changes in UI
    await syncData();

  } catch (e) {
    console.error("Update Error:", e);
    alert("Gagal update data: " + e.message);
  }
}

async function hapusKaryawan(idKaryawan) {
  if (confirm("Hapus data karyawan ini dari Cloud?")) {
    const { error } = await supabaseClient
      .from("karyawan")
      .delete()
      .eq("nik", idKaryawan);
    if (!error) await syncData();
    else alert("Gagal menghapus: " + error.message);
  }
}

function cetakSlip(index) {
  const k = KARYAWAN[index];
  const userLogs = logs.filter(l => l.nama === k.nama).slice(0, 30);
  const userKasbon = kasbonData.filter(kb => kb.nama === k.nama);
  const d = hitungDetailGaji(k.gaji, userLogs, userKasbon, k.nik);
  
  const tgl = new Date();
  const bulanIndo = [
    "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
    "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"
  ];

  const printStyles = `
    <style>
      @page { size: A5; margin: 0; }
      body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; }
      .print-container { 
        width: 148mm; 
        height: 210mm; 
        padding: 10mm; 
        box-sizing: border-box; 
        background: #fff; 
        position: relative;
        overflow: hidden;
      }
      * { box-sizing: border-box; }
    </style>
  `;

  const isiSlip = `
    <div class="print-container" style="border: 1px solid #000; font-family: 'Arial', sans-serif; color: #000;">
        <!-- KOP SURAT PROFESIONAL -->
        <div style="display: flex; align-items: center; border-bottom: 3px double #000; padding-bottom: 15px; margin-bottom: 15px;">
            <img src="images/koboi.png" style="width: 60px; margin-right: 15px;">
            <div style="flex: 1;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 900; color: #000;">PT. KOLA BORASI INDONESIA</h2>
                <p style="margin: 2px 0; font-size: 0.6rem; line-height: 1.3;">
                    Jl. Arjuna IV Green Kartika Residence Blok EE NO.2, CIBINONG,<br>
                    KAB. BOGOR - JAWA BARAT, 16911<br>
                    <strong>PHONE:</strong> 0857-7444-4805 | <strong>WEB:</strong> www.kolaborasi.id
                </p>
            </div>
        </div>

        <p style="text-align:center; font-weight:900; font-size: 0.9rem; text-decoration: underline; margin-bottom: 15px;">
            SLIP GAJI KARYAWAN (E-PORTAL) - ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}
        </p>
        
        <div style="display:grid; grid-template-columns: 110px 10px 1fr; line-height: 1.6; font-size:0.75rem;">
            <span>ID KARYAWAN</span><span>:</span><span>${k.nik || "-"}</span>
            <span>NAMA LENGKAP</span><span>:</span><span style="font-weight:bold;">${k.nama}</span>
            <span>STATUS PAJAK</span><span>:</span><span>${d.ptkpStatus}</span>
            <span>DEPT / JABATAN</span><span>:</span><span>${k.dept} / ${k.jabatan || "-"}</span>
            <span>TOTAL KEHADIRAN</span><span>:</span><span>${d.hadir} / 22 Hari</span>
        </div>

        <div style="border-top:1px dashed #000; margin-top:15px; padding-top:10px;">
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem;"><span>Gaji Pokok Full</span><span>Rp ${d.gapok.toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem;"><span>Gaji Pro-rata (Hadir)</span><span>Rp ${Math.floor(d.gajiPro).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; color: #15803d; font-weight:bold; font-size: 0.75rem;"><span>Bonus Lembur (${d.jamLembur} Jam)</span><span>+Rp ${d.bonusLembur.toLocaleString("id-ID")}</span></div>
        </div>

        <p style="margin: 15px 0 5px 0; font-weight:bold; text-decoration: underline; font-size: 0.7rem;">POTONGAN, PAJAK & KASBON</p>
        <div style="line-height: 1.5; font-size:0.75rem;">
            <div style="display:flex; justify-content:space-between;"><span>BPJS Kesehatan (1%)</span><span>-Rp ${Math.floor(d.bpjsKes).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>JHT (2%)</span><span>-Rp ${Math.floor(d.jht).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>JP (1%)</span><span>-Rp ${Math.floor(d.jp).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>PPh 21 (Pajak)</span><span>-Rp ${Math.floor(d.pph21).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; color: #ef4444;"><span>Potongan Telat (${d.jumlahTelat}x)</span><span>-Rp ${Math.floor(d.potonganTelat).toLocaleString("id-ID")}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; color:#1e293b; border-top:1px dashed #ccc; margin-top:5px; padding-top:5px;"><span>POTONGAN KASBON</span><span>-Rp ${d.kasbon.toLocaleString("id-ID")}</span></div>
        </div>

        <div style="border: 2px solid #000; margin-top:15px; padding:10px; display:flex; justify-content:space-between; font-weight:900; font-size:1rem; background:#f8fafc;">
            <span>TAKE HOME PAY</span><span>Rp ${Math.floor(d.thp).toLocaleString("id-ID")}</span>
        </div>
        
        <div style="margin-top: 25px; display: flex; justify-content: space-between; font-size: 0.7rem;">
            <div style="text-align: center; width: 120px;">
                Penerima,<br><br><br><br>
                ( ________________ )
            </div>
            <div style="text-align: center; width: 120px;">
                Hormat Kami,<br><br><br><br>
                <strong>HRD KOBOI</strong>
            </div>
        </div>

        <p style="text-align:center; font-size:0.55rem; margin-top:20px; color: #64748b; font-style: italic;">
            E-Slip sah dikeluarkan secara digital via KOBOI Employee Portal.<br>
            Waktu Cetak: ${tgl.toLocaleString("id-ID")}
        </p>
    </div>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(`<html><head><title>Slip - ${k.nama}</title>${printStyles}</head><body>${isiSlip}<script>window.onload=function(){window.print();window.close();}<\/script></body></html>`);
    w.document.close();
  }
}

// --- UTILITAS ---
function exportData() {
  let csv = "Nama,Departemen,Waktu,Status,Telat\n";
  logs.forEach(
    (l) => {
      const info = KARYAWAN.find(k => k.nama === l.nama);
      const deptTerkini = info ? info.dept : l.dept;
      csv += `${l.nama},${deptTerkini},${new Date(l.waktu).toLocaleString("id-ID")},${l.status},${l.isLate}\n`;
    }
  );
  const a = document.createElement("a");
  a.href = window.URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `Rekap_Absensi_KOBOI_${new Date().toLocaleDateString()}.csv`;
  a.click();
}

function exportKaryawan() {
  if (typeof XLSX === 'undefined') {
    return alert("Library Excel belum siap. Mohon tunggu sebentar atau refresh halaman.");
  }

  // Ambil hanya kolom yang diminta: ID, Nama, Departemen, Jabatan, Gaji
  const dataExport = KARYAWAN.map(k => ({
    "Nomor ID Karyawan": k.nik || "-",
    "Nama": k.nama,
    "Departemen": k.dept,
    "Jabatan": k.jabatan || "-",
    "Gaji": k.gaji || 0
  }));

  // Buat workbook dan worksheet
  const worksheet = XLSX.utils.json_to_sheet(dataExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data Karyawan");

  // Download file .xlsx asli
  XLSX.writeFile(workbook, `Database_Karyawan_${new Date().toLocaleDateString()}.xlsx`);
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
  window.location.href = "admin.html";
}

function verifyAdmin() {
  const pw = document.getElementById("adminPassword").value;
  if (pw === "mautaubanget") {
    document.getElementById("adminLogin").style.display = "none";
    document.getElementById("adminPanel").style.display = "flex";
    sessionStorage.setItem("adminAuth", "true");
    syncData();
  } else {
    alert("Password Salah!");
  }
}

function logoutAdmin() {
  sessionStorage.removeItem("adminAuth");
  window.location.reload();
}

// Auto-login jika sudah ada session
if (sessionStorage.getItem("adminAuth") === "true") {
  const loginEl = document.getElementById("adminLogin");
  const panelEl = document.getElementById("adminPanel");
  if (loginEl && panelEl) {
    loginEl.style.display = "none";
    panelEl.style.display = "flex";
    syncData(); // Tambahkan sync data saat auto-login
  }
}

function showModal() {
  document.getElementById("modalKaryawan").classList.add("active");
}
function hideModal() {
  document.getElementById("modalKaryawan").classList.remove("active");
}

// Fitur tambahan: Tutup modal dengan klik backdrop atau tombol ESC
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("modalKaryawan");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideModal();
    });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideModal();
});

// --- FITUR HAPUS LOG (CLOUD VERSION) ---

// 1. Hapus SEMUA Log (Tombol Clear All)
async function clearData() {
  if (
    confirm(
      "PERINGATAN! Anda akan menghapus SELURUH data absensi di Cloud. Lanjutkan?",
    )
  ) {
    const { error } = await supabaseClient.from("logs").delete().neq("nama", ""); // Menghapus semua karena logs juga tidak punya id 0

    if (!error) {
      alert("Seluruh log berhasil dihapus!");
      await syncData(); // Segarkan tampilan
    } else {
      alert("Gagal menghapus: " + error.message);
    }
  }
}

// 2. Hapus Satu Baris Log (Opsional, jika Anda ingin menambah tombol hapus di tiap baris)
async function hapusSatuLog(waktu) {
  if (confirm("Hapus data absensi ini dari Cloud?")) {
    const { error } = await supabaseClient.from("logs").delete().eq("waktu", waktu);

    if (!error) {
      alert("Log berhasil dihapus!");
      await syncData(); // Segarkan data dan tabel
    } else {
      alert("Gagal menghapus: " + error.message);
    }
  }
}

// 3. Lengkapi ID Karyawan yang Kosong
async function generateMissingIDs() {
  const missing = KARYAWAN.filter((k) => !k.nik || k.nik === "-");
  if (missing.length === 0) {
    return alert("Semua karyawan sudah memiliki ID!");
  }

  if (
    confirm(
      `Terdapat ${missing.length} karyawan tanpa ID. Buat ID otomatis sekarang?`,
    )
  ) {
    try {
      console.log("Memulai proses pembuatan ID...");
      let successCount = 0;

      for (const k of missing) {
        const newNik = "KBI-" + Math.floor(100000 + Math.random() * 900000); // 6 digit random
        const { error } = await supabaseClient
          .from("karyawan")
          .update({ nik: newNik })
          .eq("nama", k.nama);

        if (!error) successCount++;
      }

      alert(`Berhasil melengkapi ${successCount} ID Karyawan!`);
      await syncData();
    } catch (err) {
      console.error("Gagal melengkapi ID:", err);
      alert("Terjadi kesalahan saat memperbarui database.");
    }
  }
}

// --- TABEL CUTI & IZIN ---
function renderCutiTable() {
  const tbody = document.getElementById("cutiTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (cutiData.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>Belum ada data pengajuan cuti/izin.</td></tr>";
    return;
  }

  cutiData.forEach((c) => {
    let statusBadge = `<span style="background:orange; color:white; padding:4px 8px; border-radius:8px; font-size:0.8rem;">PENDING</span>`;
    if (c.status === "APPROVED") statusBadge = `<span style="background:green; color:white; padding:4px 8px; border-radius:8px; font-size:0.8rem;">APPROVED</span>`;
    if (c.status === "REJECTED") statusBadge = `<span style="background:red; color:white; padding:4px 8px; border-radius:8px; font-size:0.8rem;">REJECTED</span>`;

    let actionBtns = `
      <button onclick="hapusCuti(${c.id})" style="background:#ef4444; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" title="Hapus Permanen">Hapus</button>
    `;
    if (c.status === "PENDING") {
      actionBtns = `
                <button onclick="updateStatusCuti(${c.id}, 'APPROVED', '${c.nik}', '${c.jenis_pengajuan}')" style="background:green; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">Setuju</button>
                <button onclick="updateStatusCuti(${c.id}, 'REJECTED', '${c.nik}', '${c.jenis_pengajuan}')" style="background:red; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; margin-left:5px;">Tolak</button>
                <button onclick="hapusCuti(${c.id})" style="background:#64748b; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; margin-left:5px;">Hapus</button>
            `;
    }

    tbody.innerHTML += `
            <tr>
                <td><strong>${c.nama}</strong><br><small>${c.nik}</small></td>
                <td><strong>${c.jenis_pengajuan}</strong></td>
                <td>${c.tanggal_mulai} <br>s/d<br> ${c.tanggal_selesai}</td>
                <td style="max-width:200px; white-space:normal;">${c.alasan}</td>
                <td>${statusBadge}</td>
                <td>${actionBtns}</td>
            </tr>
        `;
  });
}

async function updateStatusCuti(id, statusBaru, nikKaryawan, jenis) {
  if (!confirm(`Yakin ingin mengubah status menjadi ${statusBaru}?`)) return;

  try {
    // 1. Update status di tabel cuti_izin
    const { error } = await supabaseClient.from("cuti_izin").update({ status: statusBaru }).eq("id", id);
    if (error) throw error;

    // 2. Jika APPROVED dan jenisnya CUTI, kurangi sisa_cuti karyawan
    if (statusBaru === "APPROVED" && jenis === "CUTI") {
      const dataCuti = cutiData.find(c => c.id === id);
      if (dataCuti) {
        const t1 = new Date(dataCuti.tanggal_mulai);
        const t2 = new Date(dataCuti.tanggal_selesai);
        const diffTime = Math.abs(t2 - t1);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

        const kary = KARYAWAN.find(k => k.nik === nikKaryawan);
        if (kary) {
          const sisaBaru = (kary.sisa_cuti || 0) - diffDays;
          await supabaseClient.from("karyawan").update({ sisa_cuti: sisaBaru }).eq("nik", nikKaryawan);
        }
      }
    }

    alert("Status berhasil diperbarui!");
    syncData();
  } catch (e) {
    alert("Gagal update status: " + e.message);
  }
}

async function hapusCuti(id) {
  if (!confirm("Yakin ingin menghapus riwayat cuti/izin ini secara permanen?")) return;
  try {
    const { error } = await supabaseClient.from("cuti_izin").delete().eq("id", id);
    if (error) throw error;
    alert("Data cuti/izin berhasil dihapus!");
    syncData();
  } catch (e) {
    alert("Gagal hapus data: " + e.message);
  }
}

// --- TABEL KASBON ---
function renderKasbonTable() {
  const tbody = document.getElementById("kasbonTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (kasbonData.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>Belum ada data pengajuan kasbon.</td></tr>";
    return;
  }

  kasbonData.forEach((k) => {
    let statusBadge = `<span style="background:orange; color:white; padding:4px 8px; border-radius:8px; font-size:0.8rem;">PENDING</span>`;
    if (k.status === "APPROVED") statusBadge = `<span style="background:green; color:white; padding:4px 8px; border-radius:8px; font-size:0.8rem;">APPROVED</span>`;
    if (k.status === "REJECTED") statusBadge = `<span style="background:red; color:white; padding:4px 8px; border-radius:8px; font-size:0.8rem;">REJECTED</span>`;

    let actionBtns = `
      <button onclick="hapusKasbon(${k.id})" style="background:#ef4444; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" title="Hapus Permanen">Hapus</button>
    `;

    if (k.status === "PENDING") {
      actionBtns = `
                <button onclick="updateStatusKasbon(${k.id}, 'APPROVED')" style="background:green; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">Cairkan</button>
                <button onclick="updateStatusKasbon(${k.id}, 'REJECTED')" style="background:red; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; margin-left:5px;">Tolak</button>
                <button onclick="hapusKasbon(${k.id})" style="background:#64748b; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; margin-left:5px;">Hapus</button>
            `;
    }

    tbody.innerHTML += `
            <tr>
                <td><strong>${k.nama}</strong><br><small>${k.nik}</small></td>
                <td style="color:#15803d; font-weight:bold;">Rp ${k.nominal.toLocaleString("id-ID")}</td>
                <td>${new Date(k.waktu_pengajuan).toLocaleString("id-ID")}</td>
                <td style="max-width:200px; white-space:normal;">${k.alasan}</td>
                <td>${statusBadge}</td>
                <td>${actionBtns}</td>
            </tr>
        `;
  });
}

async function updateStatusKasbon(id, statusBaru) {
  if (!confirm(`Yakin ingin mengubah status kasbon menjadi ${statusBaru}?`)) return;

  try {
    const { error } = await supabaseClient.from("kasbon").update({ status: statusBaru }).eq("id", id);
    if (error) throw error;

    alert("Status kasbon berhasil diperbarui!");
    syncData();
  } catch (e) {
    alert("Gagal update kasbon: " + e.message);
  }
}

async function hapusKasbon(id) {
  if (!confirm("Yakin ingin menghapus riwayat kasbon ini secara permanen?")) return;
  try {
    const { error } = await supabaseClient.from("kasbon").delete().eq("id", id);
    if (error) throw error;
    alert("Data kasbon berhasil dihapus!");
    syncData();
  } catch (e) {
    alert("Gagal hapus data: " + e.message);
  }
}

// --- TAB DAFTAR AKUN ---
function renderAkunTable() {
  const body = document.getElementById("akunTableBody");
  if (!body) return;
  body.innerHTML = "";

  KARYAWAN.forEach((k, index) => {
    const searchData = `${(k.nama || "").toLowerCase()} ${(k.nik || "").toLowerCase()}`;
    body.innerHTML += `
      <tr class="akun-row" data-search="${searchData}">
        <td><strong>${k.nama || "-"}</strong><br><small>PTKP: ${k.status_ptkp || "-"}</small></td>
        <td>
          <code style="background:#f1f5f9; padding:4px 8px; border-radius:6px; font-weight:bold;">${k.nik || "-"}</code><br>
          <small>KTP: ${k.nik_ktp || "-"}</small>
        </td>
        <td>
          <code style="background:#fef3c7; padding:4px 8px; border-radius:6px; font-weight:bold;">${k.pin || "123456"}</code><br>
          <small>NPWP: ${k.npwp || "-"}</small>
        </td>
        <td><span class="status-tag" style="background:#ecfdf5; color:#059669; font-size:0.75rem;">${k.dept}</span></td>
        <td>
          <button onclick="showEditModal(${index})" class="btn-s" style="background:#6366f1; color:white;">EDIT</button>
          <button onclick="hapusKaryawan('${k.nik}')" class="btn-s" style="background:#ef4444; color:white; margin-left:5px;">HAPUS</button>
        </td>
      </tr>`;
  });
}

function filterAkun() {
  const query = document.getElementById("searchAkun").value.toLowerCase();
  const rows = document.querySelectorAll(".akun-row");
  rows.forEach(row => {
    const text = row.getAttribute("data-search");
    row.style.display = text.includes(query) ? "" : "none";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const editModal = document.getElementById("modalEdit");
  if (editModal) {
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) hideEditModal();
    });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideEditModal();
});

async function resetMOU(index) {
  const k = KARYAWAN[index];
  if (!confirm(`Apakah Anda yakin ingin me-reset status MOU untuk ${k.nama}?`)) return;

  try {
    const { error } = await supabaseClient
      .from("karyawan")
      .update({ mou_signed: false, mou_signature: null, mou_date: null })
      .eq("nik", k.nik);

    if (error) throw error;
    alert("Status MOU berhasil di-reset!");
    await syncData();
  } catch (err) {
    alert("Gagal reset MOU: " + err.message);
  }
}

async function confirmResetCuti() {
  if (!confirm("Peringatan: Ini akan me-reset SISA CUTI seluruh karyawan menjadi 12 hari. Lanjutkan?")) return;

  try {
    const { error } = await supabaseClient
      .from("karyawan")
      .update({ sisa_cuti: 12 });

    if (error) throw error;
    alert("Seluruh kuota cuti berhasil di-reset ke 12 hari!");
    await syncData();
  } catch (err) {
    alert("Gagal reset cuti: " + err.message);
  }
}

async function confirmResetKasbon() {
  if (!confirm("Peringatan: Ini akan MENGHAPUS SELURUH RIWAYAT KASBON di database. Lanjutkan?")) return;

  try {
    const { error } = await supabaseClient
      .from("kasbon")
      .delete()
      .not("id", "eq", 0);

    if (error) throw error;
    alert("Seluruh riwayat kasbon telah dikosongkan!");
    await syncData();
  } catch (err) {
    alert("Gagal kosongkan kasbon: " + err.message);
  }
}

function kirimWaSlip(index) {
  const userLogs = logs.filter(l => l.nama === k.nama).slice(0, 30);
  const userKasbon = kasbonData.filter(kb => kb.nama === k.nama);
  const d = hitungDetailGaji(k.gaji || 0, userLogs, userKasbon, k.nik);
  const bulanIndo = [
    "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
    "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER",
  ];
  const tgl = new Date();

  if (!k.nomor_wa) return alert("Nomor WhatsApp karyawan belum diisi!");

  // Sanitasi nomor WA
  let clearWa = k.nomor_wa.replace(/\D/g, '');
  if (clearWa.startsWith('0')) clearWa = '62' + clearWa.substring(1);

  // TRIGGER PDF (Agar admin bisa save/cetak filenya untuk dilampirkan)
  cetakSlip(index);

  const pesan = `
*SLIP GAJI DIGITAL - PT. KOLA BORASI INDONESIA*
==========================================
*PERIODE : ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}*
------------------------------------------
Nama : *${k.nama}*
NIK  : ${k.nik || "-"}
Dept : ${k.dept}
------------------------------------------
*RINCIAN PENGHASILAN (+)*
- Gaji Pokok  : Rp ${k.gaji.toLocaleString('id-ID')}
- Lembur (${d.jamLembur} Jam) : Rp ${d.bonusLembur.toLocaleString('id-ID')}
- Tunjangan   : Rp 0
------------------------------------------
*RINCIAN POTONGAN (-)*
- Kasbon      : Rp ${d.kasbon.toLocaleString('id-ID')}
- PPh21 (Pajak) : Rp ${Math.floor(d.pph21).toLocaleString('id-ID')}
- BPJS & JHT  : Rp ${(Math.floor(d.bpjsKes + d.jht + d.jp)).toLocaleString('id-ID')}
- Pot. Telat  : Rp ${Math.floor(d.potonganTelat).toLocaleString('id-ID')}
------------------------------------------
*TOTAL TERIMA (THP) : Rp ${Math.floor(d.thp).toLocaleString('id-ID')}*
==========================================

Terima kasih atas dedikasi dan kontribusi luar biasa Anda bagi *PT. Kola Borasi Indonesia*. Semoga apa yang kita cita-citakan bersama dapat tercapai untuk kemajuan perusahaan dan kesejahteraan kita semua. 

Tetap semangat dan salam profesional!

_(Lampiran PDF Slip Gaji akan dikirimkan oleh Admin setelah pesan ini)_

_Pesan ini diterbitkan secara digital melalui KOBOI Apps._
`.trim();

  const url = `https://wa.me/${clearWa}?text=${encodeURIComponent(pesan)}`;
  setTimeout(() => {
    window.open(url, "_blank");
  }, 8function adminCetakMOU(index) {
    const user = KARYAWAN[index];
    const thn = new Date().getFullYear();
    const tglSekarang = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    
    // Logic for Scope of Work & Purpose based on Dept/Jabatan
    let s_maksud = "Meningkatkan efisiensi dan profesionalitas kerja di lingkungan perusahaan.";
    let s_lingkup = "Melaksanakan tugas harian sesuai dengan Instruksi Kerja (IK) yang diberikan atasan.";
    
    if (user.dept === "OPERASIONAL") {
        s_maksud = "Menghasilkan output operasional yang aman, tepat waktu, dan berkualitas tinggi.";
        s_lingkup = "Pemeliharaan alat kerja, kepatuhan SOP Keselamatan (K3), dan pelaporan logistik lapangan.";
    } else if (user.dept === "IT" || user.dept === "TEKNIS") {
        s_maksud = "Menjamin stabilitas sistem digital dan infrastruktur teknologi perusahaan.";
        s_lingkup = "Pemeliharaan aplikasi KOBOI, manajemen database, dan troubleshooting perangkat kerja.";
    } else if (user.dept === "FINANCE" || user.dept === "AKUNTANSI") {
        s_maksud = "Menjaga integritas data keuangan dan ketepatan administrasi transaksi.";
        s_lingkup = "Pencatatan invoice, verifikasi laporan pengeluaran, dan penyiapan data payroll/pajak.";
    } else if (user.dept === "MARKETING" || user.dept === "SALES") {
        s_maksud = "Memperluas jangkauan pasar dan menjaga hubungan baik dengan klien.";
        s_lingkup = "Acquisition klien baru, manajemen media sosial, dan presentasi profil perusahaan.";
    } else if (user.dept === "HRD" || user.dept === "GA") {
        s_maksud = "Mengoptimalkan manajemen SDM dan kenyamanan kerja seluruh staf.";
        s_lingkup = "Monitoring absensi rincian, rekrutmen, dan pemeliharaan fasilitas kantor.";
    }

    const bodyMOU = `
        <div id="mouPrintArea" class="mou-print-container" style="text-align:justify; color: #000; font-family: 'Arial', sans-serif; font-size: 0.65rem; line-height: 1.15;">
            <!-- KOP SURAT PROFESIONAL -->
            <div style="display: flex; align-items: center; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 8px;">
                <img src="images/koboi.png" style="width: 40px; margin-right: 10px;">
                <div style="flex: 1;">
                    <h2 style="margin: 0; font-size: 0.85rem; font-weight: 900;">PT. KOLA BORASI INDONESIA</h2>
                    <p style="margin: 0; font-size: 0.5rem;">Jl. Arjuna IV Green Kartika Residence Blok EE NO.2, CIBINONG, BOGOR | 0857-7444-4805 | www.kolaborasi.id</p>
                </div>
            </div>

            <p style="text-align:center; font-weight:800; font-size:0.8rem; text-decoration: underline; margin-bottom: 1px;">SURAT PERJANJIAN KERJA (MOU)</p>
            <p style="text-align:center; margin-bottom:8px; font-size: 0.6rem;">Nomor: MOU/KBI/${user.nik}/${thn}</p>
            
            <p style="margin-bottom: 3px;">Pada hari ini, <strong>${tglSekarang}</strong>, kami yang bertanda tangan di bawah ini:</p>
            <div style="margin-left:10px; margin-bottom:8px;">
                <strong>1. PT. KOLA BORASI INDONESIA</strong>, beralamat di Cibinong, Bogor, diwakili oleh Manajemen HRD, selanjutnya disebut <strong>"PIHAK PERTAMA"</strong>.<br>
                <strong>2. ${user.nama}</strong>, ID/NIK: ${user.nik}, Jabatan: ${user.jabatan || user.dept}, beralamat sesuai data database, disebut <strong>"PIHAK KEDUA"</strong>.
            </div>

            <p style="margin-bottom: 4px;"><strong>PASAL 1: LATAR BELAKANG & MAKSUD TUJUAN</strong><br>
            Bahwa PIHAK PERTAMA adalah perusahaan yang bergerak di bidang jasa/produk profesional dan PIHAK KEDUA memiliki kompetensi untuk mendukung visi tersebut. Adapun tujuannya adalah: <em>${s_maksud}</em></p>

            <p style="margin-bottom: 4px;"><strong>PASAL 2: RUANG LINGKUP & JANGKA WAKTU</strong><br>
            PIHAK KEDUA bertugas sebagai <strong>${user.jabatan || user.dept}</strong> dengan lingkup: ${s_lingkup}. Perjanjian ini berlaku selama masa aktif penempatan di KOBOI Apps.</p>

            <p style="margin-bottom: 4px;"><strong>PASAL 3: HAK & KEWAJIBAN</strong><br>
            PIHAK KEDUA wajib mematuhi jam kerja, menjaga kerahasiaan data (NDA), dan memelihara aset. PIHAK PERTAMA berkewajiban memberikan kompensasi sesuai rincian payroll digital dan fasilitas pendukung kerja.</p>

            <p style="margin-bottom: 4px;"><strong>PASAL 4: KETENTUAN BIAYA & PENDANAAN</strong><br>
            Segala pengeluaran tak Tis (operational expenses) yang dilakukan PIHAK KEDUA demi tugas wajib mendapatkan persetujuan PIHAK PERTAMA melalui sistem Reimbursement digital.</p>

            <p style="margin-bottom: 4px;"><strong>PASAL 5: PELANGGARAN & SANKSI</strong><br>
            Ketidakhadiran tanpa izin atau pelanggaran SOP keselamatan dapat dikenakan sanksi berupa pemotongan gaji sistematis atau Surat Peringatan (SP) berjenjang hingga pemutusan hubungan.</p>

            <p style="margin-bottom: 4px;"><strong>PASAL 6: PENYELESAIAN SENGKETA</strong><br>
            Apabila terjadi perselisihan, KEDUA BELAH PIHAK sepakat untuk menyelesaikan secara musyawarah untuk mufakat sebelum menempuh jalur hukum yang berlaku.</p>

            <div style="margin-top:15px; display: flex; justify-content: space-between;">
                <div style="text-align:center; width: 45%;">
                    <p style="margin-bottom: 25px;">PIHAK PERTAMA,</p>
                    <p style="font-weight: bold;">( Manajemen HRD )</p>
                </div>
                <div style="text-align:center; width: 45%;">
                    <p style="margin-bottom: 4px;">PIHAK KEDUA,</p>
                    <div style="height: 40px; display: flex; justify-content: center; align-items: center; margin-bottom: 4px;">
                        ${user.mou_signed ? `<img src="${user.mou_signature}" style="max-height: 40px; width: auto;">` : '<p style="color:red; font-size:0.5rem; border:1px dashed red; padding:2px;">[BELUM TTD]</p>'}
                    </div>
                    <p style="font-weight: bold;">( ${user.nama} )</p>
                </div>
            </div>
            
            <p style="font-size: 0.55rem; color: #64748b; margin-top: 10px; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 4px;">
                Dokumen digital ini diterbitkan otomatis melalui KOBOI Apps dan bersifat mengikat secara hukum.
            </p>
        </div>
    `;

    const windowPrint = window.open('', '', 'width=900,height=900');
    windowPrint.document.write(`
        <html>
            <head>
                <title>MOU - ${user.nama}</title>
                <style>
                    @page { size: A5; margin: 5mm; }
                    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; color: #000; -webkit-print-color-adjust: exact; }
                    img { max-width: 100%; }
                </style>
            </head>
            <body>
                ${bodyMOU}
                <script>
                    window.onload = function() { 
                        setTimeout(() => { window.print(); window.close(); }, 500);
                    };
                </script>
            </body>
        </html>
    `);
    windowPrint.document.close();
}
se();
}

