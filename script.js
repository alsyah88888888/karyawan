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

const OFFICE_IP = "103.108.130.43";
let KARYAWAN = [];
let logs = [];
let cutiData = [];
let kasbonData = [];
let adminMap = null;
let routeLayers = [];
let isOfficeGlobal = false;
let clockClicks = 0;
let lastClickTime = 0;
let isMOUVisible = false; // Main toggle state

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

    // Ambil Settings (HRIS Settings)
    const { data: dataSet, error: errSet } = await supabaseClient.from("hris_settings").select("*");
    if (!errSet) {
      const mouSet = dataSet.find(s => s.key === "mou_visible");
      isMOUVisible = mouSet ? mouSet.value === "true" : false;
    }

    // Set default Periode Payroll (Jika belum ada)
    const pMonth = document.getElementById("payrollMonth");
    const pYear = document.getElementById("payrollYear");
    if (pMonth && !pMonth.dataset.init) {
      const now = new Date();
      pMonth.value = now.getMonth();
      pYear.value = now.getFullYear();
      pMonth.dataset.init = "true";
    }

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

  // Perlakuan Khusus Driver
  if (info && info.jabatan === "DRIVER") {
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
function hitungDetailGaji(gapok, logsData, kasbonData, employeeObj) {
  const info = employeeObj;
  const jabatan = (info?.jabatan || "").toUpperCase().trim();
  const gapokValue = parseFloat(gapok) || 0;

  // 1. DETERMINE ROLE (Operasional vs Admin/Office)
  const namaKaryawan = (info?.nama || "").toUpperCase().trim();
  const daftarPengecualian = ["TATANG", "IMAM MAHDI", "WAWAN KURNIAWAN", "WAWAN"];
  const isPengecualian = daftarPengecualian.some(exc => exc.includes(namaKaryawan) || namaKaryawan.includes(exc));
  const isOperasional = jabatan.includes("DRIVER") || jabatan.includes("HELPER") || jabatan.includes("OPERASIONAL") || isPengecualian;

  // 2. PENENTUAN TARIF HKE (Revised Rule: Operasional /24, Admin /26)
  let divisor = isOperasional ? 24 : 26;
  let tarifHKE = gapokValue > 0 ? Math.round(gapokValue / divisor) : (isOperasional ? 200000 : 0);

  // 3. JAM LEMBUR (OVERTIME)
  const pMonth = document.getElementById("payrollMonth")?.value;
  const pYear = document.getElementById("payrollYear")?.value;
  
  const now = new Date();
  const currentMonth = pMonth !== undefined ? parseInt(pMonth) : now.getMonth();
  const currentYear = pYear !== undefined ? parseInt(pYear) : now.getFullYear();

  const logsByDate = {};
  logsData.forEach(l => {
    const logDate = new Date(l.waktu);

    // Logika Shift Lintas Hari: Jika absen di bawah jam 06:00 pagi,
    // anggap itu bagian dari shift hari sebelumnya.
    let shiftDate = new Date(logDate);
    if (shiftDate.getHours() < 6) {
      shiftDate.setDate(shiftDate.getDate() - 1);
    }

    if (shiftDate.getMonth() === currentMonth && shiftDate.getFullYear() === currentYear) {
      const d = shiftDate.toLocaleDateString("id-ID");
      if (!logsByDate[d]) logsByDate[d] = [];
      logsByDate[d].push(l);
    }
  });

  let totalJamLembur = 0;
  let totalJamKerja = 0; // Tambahan untuk mengecek jam kerja murni

  // Variabel untuk menghitung akumulasi HKE harian dengan penalti telat
  let totalHkeHarianAcumulated = 0;
  let potonganTelatHarianAcumulated = 0;

  // Tarif Harian Dasar untuk perhitungan potongan telat (Sudah pakai tarifHKE yang sesuai role)
  let tarifHariDasar = tarifHKE;

  const uniqueDates = Object.keys(logsByDate);
  const hariHadir = uniqueDates.filter(d =>
    logsByDate[d].some(l => l.status === "MASUK" || l.status === "BERANGKAT")
  ).length;

  uniqueDates.forEach(date => {
    const dayLogs = logsByDate[date].sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
    const firstIn = dayLogs.find(l => l.status === "MASUK" || l.status === "BERANGKAT");
    const lastOut = [...dayLogs].reverse().find(l => l.status === "PULANG" || l.status === "KEMBALI" || l.status === "SAMPAI");

    if (firstIn) {
      const inTime = new Date(firstIn.waktu);

      // 1. CEK KETERLAMBATAN UNIVERSAL (Batas max 09:18)
      const batasTelat = new Date(inTime);
      batasTelat.setHours(9, 18, 0, 0);

      if (inTime > batasTelat) {
        // Telat: Potong 50% dari tarif harian
        totalHkeHarianAcumulated += (tarifHariDasar * 0.5);
        potonganTelatHarianAcumulated += (tarifHariDasar * 0.5);
      } else {
        // Tepat waktu: Full HKE harian
        totalHkeHarianAcumulated += tarifHariDasar;
      }

      // 2. JAM KERJA & OVERTIME (JIKA ADA JAM PULANG)
      if (lastOut) {
        const firstInDate = new Date(firstIn.waktu);
        const lastOutDate = new Date(lastOut.waktu);

        // Hitung total jam kerja hari ini (dari absen masuk ke pulang)
        const jamKerjaHariIni = (lastOutDate - firstInDate) / (1000 * 3600);
        if (jamKerjaHariIni > 0 && jamKerjaHariIni <= 24) {
          totalJamKerja += jamKerjaHariIni;

          // OVERTIME UNIVERSAL: Dihitung dari kelebihan jam kerja harian > 9 Jam
          if (jamKerjaHariIni > 9) {
            const overtimeHariIni = jamKerjaHariIni - 9;
            // Sanity check batasan maksimal lembur murni per hari (kasus lupa absen)
            if (overtimeHariIni <= 14) {
              totalJamLembur += overtimeHariIni;
            }
          }
        }
      }
    }
  });

  let totalOvertimeRp = Math.floor(totalJamLembur) * 10000;

  // 3. INSENTIF (LK & REGULER)
  let incentiveLK = parseFloat(info?.insentif_lk) || 0;
  let incentiveReguler = 0;

  // Evaluasi Incentive Reguler (Berbasis rata-rata jam kerja >= 9 Jam)
  const rataRataJamKerja = hariHadir > 0 ? (totalJamKerja / hariHadir) : 0;
  if (rataRataJamKerja >= 9) {
    incentiveReguler = 200000;
  } else if (info?.insentif_reguler === "Ya" || info?.insentif_reguler === "YA") {
    incentiveReguler = 200000;
  }

  // 4. PERLAKUAN KHUSUS (PENGECUALIAN & DIVISI)

  // A. Pengecualian nama tertentu (Tidak dapat OT & Reguler)
  if (isPengecualian) {
    totalOvertimeRp = 0;
    incentiveReguler = 0;
  }

  // B. Divisi Non-Operasional (ADMIN, dll)
  if (!isOperasional) {
    incentiveLK = 0;
    incentiveReguler = 0;
    // Berdasarkan instruksi "hitungamn dari jam kerja lebih karyawan dari jam 9 jam tersebut", Admin DAPAT overtime > 9 jam
    // Jadi totalOvertimeRp TETAP DIHITUNG untuk Admin.
  }

  // 5. POTONGAN
  const totalKasbon = kasbonData
    ? kasbonData.filter(k => k.status === 'APPROVED').reduce((sum, k) => sum + parseFloat(k.nominal), 0)
    : 0;
  const pinjaman = parseFloat(info?.pinjaman) || 0;
  const potHKE = parseFloat(info?.pot_hke) || 0;

  // 6. RUMUS UTAMA FINANSIAL - GAJI POKOK HANYA UNTUK TAMPILAN, TIDAK DITAMBAHKAN!
  // Semua Total Penerimaan murni berasal dari Akumulasi HKE Harian (yang sudah memperhitungkan absen & telat) + Tunjangan

  // Pendapatan HKE utama menggunakan hasil akumulasi yang sudah dikurangi penalti telat
  let pendapatanHKE = totalHkeHarianAcumulated;

  const totalPenerimaan = pendapatanHKE + incentiveLK + incentiveReguler + totalOvertimeRp;
  const totalPotongan = totalKasbon + pinjaman + potHKE;
  const gajiBersih = totalPenerimaan - totalPotongan;

  return {
    nama: info?.nama || "Unknown",
    jabatan: jabatan,
    hadir: hariHadir,
    gapok: gapokValue, // Gapok murni dikembalikan untuk label di struk (tidak masuk Total)
    pendapatanHKE,
    tarifHKE: tarifHKE,
    incentiveLK,
    incentiveReguler,
    bonusLembur: totalOvertimeRp,
    jamLembur: totalJamLembur,
    kasbon: totalKasbon,
    pinjaman,
    potHKE, // Anda bisa menambahkan adminPotonganTelat ke label ini jika mau, atau biarkan HKE yang berkurang.
    totalPenerimaan,
    totalPotongan,
    thp: gajiBersih > 0 ? gajiBersih : 0
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
async function loadDriverRute() {
  const select = document.getElementById("trackDriverSelect");
  const dateInput = document.getElementById("trackDate");
  const detailPanel = document.getElementById("routeDetails");

  const nik = select.value;
  const tgl = dateInput.value;

  if (!nik || !tgl) return;

  // Clear previous layers
  routeLayers.forEach(layer => adminMap.removeLayer(layer));
  routeLayers = [];

  try {
    // Note: Database uses 'delivery_logs' table, not 'driver_tracking'
    const { data: rute, error } = await supabaseClient
      .from("delivery_logs")
      .select("*")
      .eq("nik", nik)
      .gte("created_at", tgl + "T00:00:00")
      .lte("created_at", tgl + "T23:59:59")
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!rute || rute.length === 0) {
      detailPanel.innerText = "Tidak ada rute ditemukan pada tanggal ini.";
      return;
    }

    const points = [];
    rute.forEach((pt, idx) => {
      const pos = [pt.latitude, pt.longitude];
      points.push(pos);
      const marker = L.marker(pos).addTo(adminMap)
        .bindPopup(`<b>Henti #${idx + 1}</b><br>${pt.keterangan}<br>${new Date(pt.created_at).toLocaleTimeString('id-ID')}`);
      routeLayers.push(marker);
    });

    if (points.length > 1) {
      const polyline = L.polyline(points, { color: '#4f46e5', weight: 4 }).addTo(adminMap);
      routeLayers.push(polyline);
    }

    const group = new L.featureGroup(routeLayers.filter(l => l instanceof L.Marker));
    adminMap.fitBounds(group.getBounds().pad(0.3));
    detailPanel.innerHTML = `Terlacak <b>${rute.length} titik</b> untuk <b>${rute[0].nama}</b>.`;

  } catch (err) {
    console.error("Load Rute Error:", err);
  }
}



function initAdminMap() {
  if (adminMap) {
    adminMap.invalidateSize();
    return;
  }
  adminMap = L.map('adminMap').setView([-6.2000, 106.8166], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(adminMap);
}

function initTrackSelect() {
  const select = document.getElementById("trackDriverSelect");
  if (!select || select.options.length > 1) return;

  const drivers = KARYAWAN.filter(k => k.jabatan === "DRIVER" || k.jabatan === "Driver");
  select.innerHTML = `<option value="">-- Pilih Driver --</option>`;
  drivers.forEach(d => {
    select.innerHTML += `<option value="${d.nik}">${d.nama}</option>`;
  });

  const dateInput = document.getElementById("trackDate");
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

function switchTab(tab) {
  // 1. Sembunyikan semua konten
  document.getElementById("btnTabLog").classList.remove("nav-active");
  document.getElementById("btnTabKaryawan").classList.remove("nav-active");
  document.getElementById("btnTabCuti").classList.remove("nav-active");
  document.getElementById("btnTabKasbon").classList.remove("nav-active");
  document.getElementById("btnTabAkun").classList.remove("nav-active");
  document.getElementById("btnTabTracking").classList.remove("nav-active");

  document.getElementById("tabLog").style.display = "none";
  document.getElementById("tabKaryawan").style.display = "none";
  document.getElementById("tabCuti").style.display = "none";
  document.getElementById("tabKasbon").style.display = "none";
  document.getElementById("tabAkun").style.display = "none";
  document.getElementById("tabTracking").style.display = "none";

  // 2. Logika untuk memunculkan tab dan mengisi data
  if (tab === "log") {
    document.getElementById("tabLog").style.display = "flex";
    document.getElementById("btnTabLog").classList.add("nav-active");
    renderTabel();
  } else if (tab === "karyawan") {
    document.getElementById("tabKaryawan").style.display = "flex";
    document.getElementById("btnTabKaryawan").classList.add("nav-active");
    renderKaryawanTable();
  } else if (tab === "cuti") {
    document.getElementById("tabCuti").style.display = "flex";
    document.getElementById("btnTabCuti").classList.add("nav-active");
    renderCutiTable();
  } else if (tab === "kasbon") {
    document.getElementById("tabKasbon").style.display = "flex";
    document.getElementById("btnTabKasbon").classList.add("nav-active");
    renderKasbonTable();
  } else if (tab === "akun") {
    document.getElementById("tabAkun").style.display = "flex";
    document.getElementById("btnTabAkun").classList.add("nav-active");
    renderAkunTable();
  } else if (tab === "tracking") {
    document.getElementById("tabTracking").style.display = "flex";
    document.getElementById("btnTabTracking").classList.add("nav-active");
    initAdminMap();
    initTrackSelect();
  }
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

  // Update MOU Toggle Button UI
  const btnMOU = document.getElementById("btnToggleMOU");
  if (btnMOU) {
    if (isMOUVisible) {
      btnMOU.innerText = "MOU: TERLIHAT";
      btnMOU.style.background = "var(--primary)";
    } else {
      btnMOU.innerText = "MOU: SEMBUNYI";
      btnMOU.style.background = "#64748b";
    }
  }
}

async function toggleMOUVisibility() {
  const newVal = !isMOUVisible;
  try {
    const { error } = await supabaseClient
      .from("hris_settings")
      .update({ value: newVal.toString(), updated_at: new Date().toISOString() })
      .eq("key", "mou_visible");

    if (error) throw error;
    isMOUVisible = newVal;
    updateBadges();
    renderKaryawanTable(); // Refresh table to show/hide MOU button
    alert(isMOUVisible ? "Menu MOU sekarang TERLIHAT di Portal Karyawan." : "Menu MOU sekarang DISEMBUNYIKAN dari Portal Karyawan.");
  } catch (e) {
    alert("Gagal mengubah visibilitas MOU: " + e.message);
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
                    <button onclick="editWaktuLog('${l.id}', '${l.nama.replace(/'/g, "\\'")}', '${l.status}', '${l.waktu}')" style="display:block; margin-top:5px; color:#f59e0b; border:none; background:none; cursor:pointer; font-size:0.7rem; font-weight:bold;">[EDIT WAKTU]</button>
                    <button onclick="hapusSatuLog('${l.id}')" style="display:block; margin-top:5px; color:var(--danger); border:none; background:none; cursor:pointer; font-size:0.7rem; font-weight:bold;">[HAPUS LOG]</button>
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
    try {
      const userLogs = logs.filter(l => l.nama === k.nama).slice(0, 100);
      const userKasbon = kasbonData.filter(kb => kb.nama === k.nama);
      const d = hitungDetailGaji(k.gaji || 0, userLogs, userKasbon, k);
      body.innerHTML += `
        <tr style="font-size: 0.85rem;">
          <td>
            <div style="font-weight:800; line-height:1.1;">${k.nama}</div>
            <div style="font-size:0.65rem; color:var(--text-muted);">NIK: ${k.nik || "-"} | TTD: ${k.mou_signed ? '✅' : '⏳'}</div>
          </td>
          <td>
            <div style="font-weight:600; line-height:1.1;">${k.dept}</div>
            <div style="font-size:0.65rem; color:var(--text-muted);">${k.jabatan || "-"}</div>
            <div style="font-size:0.65rem; color:var(--accent); font-weight:700;">HKE: Rp ${d.tarifHKE.toLocaleString('id-ID')} / hari</div>
          </td>
          <td style="text-align:center;">
            <div style="font-weight:600;">${d.hadir} Hari</div>
            <div style="font-size:0.65rem; color:#15803d; font-weight:600;">OT: ${Math.floor(d.jamLembur)}j</div>
          </td>
          <td>
            <div style="font-weight:600; line-height:1.1;">Gapok: Rp ${(k.gaji || 0).toLocaleString('id-ID')}</div>
            <div style="font-size:0.65rem; color:var(--text-muted);">LK: Rp ${(k.insentif_lk || 0).toLocaleString('id-ID')}</div>
            <div style="font-size:0.65rem; color:var(--text-muted);">Reg: Rp ${d.incentiveReguler.toLocaleString('id-ID')}</div>
            <div style="font-size:0.65rem; color:#15803d; font-weight:600;">Lembur: Rp ${d.bonusLembur.toLocaleString("id-ID")}</div>
          </td>
          <td style="color:var(--accent); font-weight:800;">
            Rp ${Math.floor(d.thp).toLocaleString("id-ID")}
            <div style="font-size:0.65rem; color:var(--danger); font-weight:normal;">Kasbon: Rp ${d.kasbon.toLocaleString('id-ID')}</div>
            <div style="font-size:0.65rem; color:var(--danger); font-weight:normal;">Pinjaman: Rp ${(k.pinjaman || 0).toLocaleString('id-ID')}</div>
            <div style="font-size:0.65rem; color:var(--danger); font-weight:normal;">Pot HKE: Rp ${(k.pot_hke || 0).toLocaleString('id-ID')}</div>
          </td>
          <td style="font-size: 0.65rem; color:var(--text-muted); line-height:1.2; min-width:140px;">
            <div>KTP: ${k.nik_ktp || "-"}</div>
            <div>NPWP: ${k.npwp || "-"}</div>
            <div style="margin-top:4px; color:var(--accent); font-weight:700;">BANK: ${k.norek || "-"}</div>
          </td>
          <td>
            <div style="font-size: 0.65rem; color:var(--text-muted); margin-bottom:5px;">WA: ${k.nomor_wa || "-"}</div>
            <div style="display:flex; gap:3px;">
              <button onclick="cetakSlip(${index})" class="status-tag status-masuk" style="border:none; cursor:pointer; font-size:0.6rem; padding:3px 6px;">PDF</button>
              <button onclick="kirimWaSlip(${index})" class="status-tag" style="background:#dcfce7; color:#15803d; border:none; cursor:pointer; font-size:0.6rem; padding:3px 6px;">WA</button>
              <button onclick="adminCetakMOU(${index})" class="status-tag status-pulang" style="border:none; cursor:pointer; font-size:0.6rem; padding:3px 6px; display: ${isMOUVisible ? 'inline-block' : 'none'};">MOU</button>
            </div>
          </td>
        </tr>`;
    } catch (e) {
      console.error("Error rendering row for:", k.nama, e);
    }
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
    const gaji = parseFloat(gajiEl.value.replace(/\./g, '')) || 0;
    const dept = deptEl.value;
    const nik = nikEl?.value.trim() || "KBI-" + Math.floor(100000 + Math.random() * 900000);
    const jabatan = jabEl?.value.trim() || dept;
    const tahun = document.getElementById("inpTahun")?.value.trim() || "";
    const pin = pinEl ? pinEl.value.trim() : "";
    const nomor_wa = document.getElementById("inpWa")?.value.trim() || "";
    const norek = document.getElementById("inpNorek")?.value.trim() || "";
    const sisa_cuti = cutiEl ? parseInt(cutiEl.value) || 12 : 12;
    const insentif_lk = parseFloat(document.getElementById("inpInsentifLK")?.value) || 0;
    const insentif_reguler = document.getElementById("inpInsentifReg")?.value || "Tidak";
    const pinjaman = parseFloat(document.getElementById("inpPinjaman")?.value) || 0;
    const pot_hke = parseFloat(document.getElementById("inpPotHke")?.value) || 0;

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
      status_ptkp,
      norek,
      insentif_lk,
      insentif_reguler,
      pinjaman,
      pot_hke
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
    if (document.getElementById("inpNorek")) document.getElementById("inpNorek").value = "";
    if (cutiEl) cutiEl.value = "12";
    if (document.getElementById("inpInsentifLK")) document.getElementById("inpInsentifLK").value = "0";
    if (document.getElementById("inpInsentifReg")) document.getElementById("inpInsentifReg").value = "Tidak";
    if (document.getElementById("inpPinjaman")) document.getElementById("inpPinjaman").value = "0";
    if (document.getElementById("inpPotHke")) document.getElementById("inpPotHke").value = "0";
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
  setVal("editNorek", k.norek || "");
  setVal("editPtkp", k.status_ptkp || "TK/0");
  setVal("editInsentifLK", k.insentif_lk || 0);
  setVal("editInsentifReg", k.insentif_reguler || "Tidak");
  setVal("editPinjaman", k.pinjaman || 0);
  setVal("editPotHke", k.pot_hke || 0);

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
    const gaji = parseFloat(getVal("editGaji").replace(/\./g, '')) || 0;
    const tahun = getVal("editTahun");
    const pin = getVal("editPin");
    const sisa_cuti = parseInt(getVal("editCuti")) || 0;

    const nik_ktp = getVal("editNikKtp");
    const npwp = getVal("editNpwp");
    const nomor_wa = getVal("editWa");
    const norek = getVal("editNorek");
    const status_ptkp = document.getElementById("editPtkp")?.value || "TK/0";
    
    // Tambahkan field baru yang belum ada di update
    const insentif_lk = parseFloat(getVal("editInsentifLK")) || 0;
    const insentif_reguler = document.getElementById("editInsentifReg")?.value || "Tidak";
    const pinjaman = parseFloat(getVal("editPinjaman")) || 0;
    const pot_hke = parseFloat(getVal("editPotHke")) || 0;

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
      norek,
      status_ptkp,
      insentif_lk,
      insentif_reguler,
      pinjaman,
      pot_hke
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
  const userLogs = logs.filter(l => l.nama === k.nama).slice(0, 100);
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
      body { margin: 0; padding: 0; font-family: 'Outfit', sans-serif; color: #1e293b; background: #fff; -webkit-print-color-adjust: exact; }
      .print-container { 
        width: 148mm; 
        height: 210mm;
        padding: 10mm; 
        box-sizing: border-box; 
        border: 1px solid #e2e8f0;
      }
      .header { display: flex; align-items: center; border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 20px; }
      .header img { width: 50px; margin-right: 15px; }
      .company-info h1 { font-size: 1.1rem; margin: 0; color: #0f172a; font-weight: 800; }
      .company-info p { font-size: 0.65rem; margin: 2px 0; color: #64748b; }
      
      .title { text-align: center; font-size: 0.9rem; font-weight: 800; text-decoration: underline; margin-bottom: 20px; text-transform: uppercase; }
      
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 0.75rem; margin-bottom: 20px; background: #f8fafc; padding: 10px; border-radius: 8px; }
      .meta-item { line-height: 1.6; }
      .meta-label { color: #64748b; font-weight: 600; }
      
      .section-title { font-size: 0.7rem; font-weight: 800; color: #6366f1; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 10px; }
      
      .item-row { display: flex; justify-content: space-between; font-size: 0.75rem; padding: 5px 0; border-bottom: 1px dashed #f1f5f9; }
      .item-row.total { font-weight: 800; border-top: 2px solid #1e293b; border-bottom: none; margin-top: 10px; font-size: 0.85rem; padding-top: 10px; }
      .item-row.subtotal { color: #6366f1; font-weight: 700; margin-top: 5px; }
      
      .footer { margin-top: 40px; display: flex; justify-content: space-between; text-align: center; font-size: 0.75rem; }
      .sig-box { width: 150px; }
      .sig-space { height: 60px; }
      
      .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 4rem; color: rgba(0,0,0,0.03); font-weight: 900; pointer-events: none; z-index: -1; }
    </style>
  `;

  const metaHtml = `
    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">ID Karyawan:</span> ${k.nik || "-"}<br>
        <span class="meta-label">Departemen:</span> ${k.dept}<br>
        <span class="meta-label">Jabatan:</span> ${k.jabatan || "-"}<br>
        <span class="meta-label">Hari Hadir:</span> ${d.hadir} Hari
      </div>
      <div class="meta-item" style="text-align: right;">
        <span class="meta-label">Bulan:</span> ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}<br>
        <span class="meta-label">Tgl Bayar:</span> ${tgl.toLocaleDateString('id-ID')}<br>
        <span class="meta-label">Transfer:</span> ${(k.norek || "-").substring(0, 15)}
      </div>
    </div>
  `;

  const isiSlip = `
    <div class="print-container">
        <div class="watermark">COPY CONFIDENTIAL</div>
        <div class="header">
            <img src="images/koboi.png">
            <div class="company-info">
                <h1>PT. KOLA BORASI INDONESIA</h1>
                <p>Jl. Arjuna IV Green Kartika Residence, Cibinong, Bogor</p>
                <p>Phone: 0857-7444-4805 | Web: www.kolaborasi.id</p>
            </div>
        </div>

        <div class="title">SLIP GAJI KARYAWAN (RESMI)</div>

        <p style="font-size: 0.8rem; margin-bottom: 10px;">Diberikan kepada: <strong>${k.nama.toUpperCase()}</strong></p>
        
        ${metaHtml}

        <div class="section-title">Penerimaan Dasar & Insentif</div>
        <div class="item-row">
            <span>HKE (Rp ${d.tarifHKE.toLocaleString()} x ${d.hadir} Hari)</span>
            <span>Rp ${d.pendapatanHKE.toLocaleString()}</span>
        </div>
        ${d.bonusLembur > 0 ? `
        <div class="item-row">
            <span>Lembur (${Math.floor(d.jamLembur)} Jam x Rp 10.000)</span>
            <span>Rp ${d.bonusLembur.toLocaleString()}</span>
        </div>` : ""}
        ${d.incentiveLK > 0 ? `
        <div class="item-row">
            <span>Insentif LK</span>
            <span>Rp ${d.incentiveLK.toLocaleString()}</span>
        </div>` : ""}
        ${d.incentiveReguler > 0 ? `
        <div class="item-row">
            <span>Insentif Reguler</span>
            <span>Rp ${d.incentiveReguler.toLocaleString()}</span>
        </div>` : ""}
        <div class="item-row subtotal">
            <span>SUBTOTAL PENERIMAAN</span>
            <span>Rp ${d.totalPenerimaan.toLocaleString()}</span>
        </div>

        <div class="section-title" style="margin-top: 15px;">Potongan & Kasbon</div>
        ${d.kasbon > 0 ? `
        <div class="item-row">
            <span>Potongan Kasbon (Log)</span>
            <span style="color: #ef4444;">- Rp ${d.kasbon.toLocaleString()}</span>
        </div>` : ""}
        ${d.pinjaman > 0 ? `
        <div class="item-row">
            <span>Potongan Pinjaman/Kasbon Tetap</span>
            <span style="color: #ef4444;">- Rp ${d.pinjaman.toLocaleString()}</span>
        </div>` : ""}
        ${d.potHKE > 0 ? `
        <div class="item-row">
            <span>Potongan HKE Khusus</span>
            <span style="color: #ef4444;">- Rp ${d.potHKE.toLocaleString()}</span>
        </div>` : ""}
        ${d.totalPotongan === 0 ? `<div class="item-row" style="color: #94a3b8; font-style: italic;"><span>Tidak ada potongan</span><span>Rp 0</span></div>` : ""}
        
        <div class="item-row total">
            <span>PENGHAZILAN BERSIH (THP)</span>
            <span>Rp ${Math.floor(d.thp).toLocaleString()}</span>
        </div>

        <div class="footer">
            <div class="sig-box">
                Penerima,<br>
                <div class="sig-space"></div>
                <strong>( ${k.nama.split(" ")[0]} )</strong>
            </div>
            <div class="sig-box">
                Hormat Kami,<br>
                <div class="sig-space"></div>
                <strong>Manajemen HRD</strong>
            </div>
        </div>
        
        <div style="text-align: center; margin-top: 30px; font-size: 0.55rem; color: #94a3b8; line-height: 1.4;">
            Pesan ini diterbitkan secara otomatis oleh KOBOI HRIS.<br>
            Waktu Cetak: ${tgl.toLocaleString('id-ID')}
        </div>
    </div>
  `;

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

  // Ambil data lengkap untuk backup database Karyawan
  const dataExport = KARYAWAN.map(k => ({
    "Nomor ID Karyawan": k.nik || "-",
    "Nama Lengkap": k.nama,
    "PIN (Password)": k.pin || "-",
    "Departemen": k.dept,
    "Jabatan": k.jabatan || "-",
    "Gaji Pokok": k.gaji || 0,
    "Insentif LK": k.insentif_lk || 0,
    "Sisa Cuti": k.sisa_cuti || 0,
    "Nomor Rekening": k.norek || "-",
    "Nomor WA": k.nomor_wa || "-",
    "NIK KTP": k.nik_ktp || "-",
    "NPWP": k.npwp || "-"
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

// 2. Edit Waktu Log via Modal (Premium UI)
function editWaktuLog(idLog, nama, statusAsli, waktuAsli) {
  // Format waktu untuk <input type="datetime-local">: YYYY-MM-DDThh:mm
  let dateObj = new Date(waktuAsli);
  let yyyy = dateObj.getFullYear();
  let mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  let dd = String(dateObj.getDate()).padStart(2, '0');
  let hh = String(dateObj.getHours()).padStart(2, '0');
  let mins = String(dateObj.getMinutes()).padStart(2, '0');
  
  let formattedForInput = `${yyyy}-${mm}-${dd}T${hh}:${mins}`;

  document.getElementById("editWaktuId").value = idLog;
  document.getElementById("editWaktuNama").value = nama;
  document.getElementById("editWaktuStatus").value = statusAsli;
  document.getElementById("editWaktuInput").value = formattedForInput;

  document.getElementById("modalEditWaktu").classList.add("active");
}

function hideEditWaktuModal() {
  document.getElementById("modalEditWaktu").classList.remove("active");
}

async function simpanEditWaktuLog() {
  const idLog = document.getElementById("editWaktuId").value;
  const newWaktuRaw = document.getElementById("editWaktuInput").value;
  
  if (!newWaktuRaw) {
    alert("Waktu tidak boleh kosong!");
    return;
  }

  // <input type="datetime-local"> mengembalikan YYYY-MM-DDThh:mm
  const newDate = new Date(newWaktuRaw);
  if (isNaN(newDate.getTime())) {
    alert("Format waktu tidak valid!");
    return;
  }

  const btn = document.querySelector("#modalEditWaktu .btn-p");
  if (btn) {
    btn.innerText = "Menyimpan...";
    btn.disabled = true;
  }

  const newWaktuISO = newDate.toISOString();
  
  const { error } = await supabaseClient.from("logs")
                        .update({ waktu: newWaktuISO })
                        .eq("id", idLog);
  
  if (btn) {
    btn.innerText = "Simpan Perubahan";
    btn.disabled = false;
  }

  if (!error) {
    alert("Waktu berhasil diubah!");
    hideEditWaktuModal();
    await syncData(); // Segarkan data dan tabel
  } else {
    alert("Gagal mengubah waktu: " + error.message);
  }
}

async function hapusSatuLog(idLog) {
  if (confirm("Hapus data absensi ini dari Cloud?")) {
    const { error } = await supabaseClient.from("logs").delete().eq("id", idLog);

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
  const k = KARYAWAN[index];
  const userLogs = logs.filter(l => l.nama === k.nama).slice(0, 100);
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



  const pesan = `
*SLIP GAJI DIGITAL - PT. KOLA BORASI INDONESIA*
==========================================
*PERIODE : ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}*
------------------------------------------
Nama : *${k.nama}*
NIK  : ${k.nik || "-"}
Dept : ${k.dept}
${(k.gaji > 0) ? `Gapok: Rp ${k.gaji.toLocaleString('id-ID')}` : ""}
------------------------------------------
*RINCIAN PENGHASILAN (+)*
- HKE (${d.hadir} Hari) : Rp ${d.pendapatanHKE.toLocaleString('id-ID')}
- Lembur (${d.jamLembur} Jam) : Rp ${d.bonusLembur.toLocaleString('id-ID')}
${d.incentiveLK > 0 ? `- Inc LK      : Rp ${d.incentiveLK.toLocaleString('id-ID')}
` : ""}${d.incentiveReguler > 0 ? `- Inc Reguler : Rp ${d.incentiveReguler.toLocaleString('id-ID')}
` : ""}------------------------------------------
*RINCIAN POTONGAN (-)*
- Kasbon      : Rp ${d.kasbon.toLocaleString('id-ID')}
- Pinjaman    : Rp ${d.pinjaman.toLocaleString('id-ID')}
- Pot. HKE    : Rp ${d.potHKE.toLocaleString('id-ID')}
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
  }, 800);
}

function adminCetakMOU(index) {
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
        <div id="mouPrintArea" class="mou-print-container" style="text-align:justify; color: #000; font-family: 'Arial', sans-serif; font-size: 0.9rem; line-height: 1.5; max-width: 800px; margin: 0 auto;">
            <!-- KOP SURAT PROFESIONAL -->
            <div style="display: flex; align-items: center; border-bottom: 3px double #000; padding-bottom: 10px; margin-bottom: 20px;">
                <img src="images/koboi.png" style="width: 60px; margin-right: 15px;">
                <div style="flex: 1;">
                    <h2 style="margin: 0; font-size: 1.2rem; font-weight: 900;">PT. KOLA BORASI INDONESIA</h2>
                    <p style="margin: 2px 0; font-size: 0.75rem;">Jl. Arjuna IV Green Kartika Residence Blok EE NO.2, CIBINONG, BOGOR</p>
                    <p style="margin: 0; font-size: 0.75rem;"><strong>PHONE:</strong> 0857-7444-4805 | <strong>WEB:</strong> www.kolaborasi.id</p>
                </div>
            </div>

            <p style="text-align:center; font-weight:800; font-size:1.1rem; text-decoration: underline; margin-bottom: 5px;">SURAT PERJANJIAN KERJA (MOU)</p>
            <p style="text-align:center; margin-bottom:25px; font-size: 0.9rem;">Nomor: MOU/KBI/${user.nik}/${thn}</p>
            
            <p style="margin-bottom: 10px;">Pada hari ini, <strong>${tglSekarang}</strong>, kami yang bertanda tangan di bawah ini:</p>
            <div style="margin-left:20px; margin-bottom:15px;">
                <strong>1. PT. KOLA BORASI INDONESIA</strong>, beralamat di Cibinong, Bogor, diwakili oleh Manajemen HRD, selanjutnya disebut <strong>"PIHAK PERTAMA"</strong>.<br>
                <strong>2. ${user.nama}</strong>, ID/NIK: ${user.nik}, Jabatan: ${user.jabatan || user.dept}, beralamat sesuai data database, disebut <strong>"PIHAK KEDUA"</strong>.
            </div>

            <p style="margin-bottom: 10px;"><strong>PASAL 1: LATAR BELAKANG & MAKSUD TUJUAN</strong><br>
            Bahwa PIHAK PERTAMA adalah perusahaan yang bergerak di bidang jasa/produk profesional dan PIHAK KEDUA memiliki kompetensi untuk mendukung visi tersebut. Adapun tujuannya adalah: <em>${s_maksud}</em></p>

            <p style="margin-bottom: 10px;"><strong>PASAL 2: RUANG LINGKUP & JANGKA WAKTU</strong><br>
            PIHAK KEDUA bertugas sebagai <strong>${user.jabatan || user.dept}</strong> dengan lingkup: ${s_lingkup}. Perjanjian ini berlaku selama masa aktif penempatan di KOBOI Apps.</p>

            <p style="margin-bottom: 10px;"><strong>PASAL 3: HAK & KEWAJIBAN</strong><br>
            PIHAK KEDUA wajib mematuhi jam kerja, menjaga kerahasiaan data (NDA), dan memelihara aset. PIHAK PERTAMA berkewajiban memberikan kompensasi sesuai rincian payroll digital dan fasilitas pendukung kerja.</p>

            <p style="margin-bottom: 10px;"><strong>PASAL 4: KETENTUAN BIAYA & PENDANAAN</strong><br>
            Segala pengeluaran tak Tis (operational expenses) yang dilakukan PIHAK KEDUA demi tugas wajib mendapatkan persetujuan PIHAK PERTAMA melalui sistem Reimbursement digital.</p>

            <p style="margin-bottom: 10px;"><strong>PASAL 5: PELANGGARAN & SANKSI</strong><br>
            Ketidakhadiran tanpa izin atau pelanggaran SOP keselamatan dapat dikenakan sanksi berupa pemotongan gaji sistematis atau Surat Peringatan (SP) berjenjang hingga pemutusan hubungan.</p>

            <p style="margin-bottom: 10px;"><strong>PASAL 6: PENYELESAIAN SENGKETA</strong><br>
            Apabila terjadi perselisihan, KEDUA BELAH PIHAK sepakat untuk menyelesaikan secara musyawarah untuk mufakat sebelum menempuh jalur hukum yang berlaku.</p>

            <div style="margin-top:40px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 20px;">
                <div style="text-align:center; min-width: 200px; flex: 1;">
                    <p style="margin-bottom: 60px;">PIHAK PERTAMA,</p>
                    <p style="font-weight: bold; border-bottom: 1px solid #000; display: inline-block; padding: 0 10px;">( Manajemen HRD )</p>
                </div>
                <div style="text-align:center; min-width: 200px; flex: 1;">
                    <p style="margin-bottom: 10px;">PIHAK KEDUA,</p>
                    <div style="height: 60px; display: flex; justify-content: center; align-items: center; margin-bottom: 10px;">
                        ${user.mou_signed ? `<img src="${user.mou_signature}" style="max-height: 60px; width: auto;">` : '<p style="color:red; font-size:0.7rem; border:1px dashed red; padding:5px;">[BELUM TTD]</p>'}
                    </div>
                    <p style="font-weight: bold; border-bottom: 1px solid #000; display: inline-block; padding: 0 10px;">( ${user.nama} )</p>
                </div>
            </div>
            
            <p style="font-size: 0.7rem; color: #64748b; margin-top: 50px; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
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
                    @page { size: A4; margin: 20mm; }
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

