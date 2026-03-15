/**
 * KOBOI ESS - Logic Layer
 * Features: Login, Dashboard Sync, Leave/Loan Submission, Salary Estimation
 */

const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let currentLogs = [];
let currentKasbon = [];
let mapDriver = null;
let markerDriver = null;
let sigCanvas = null;
let sigContext = null;
let isDrawing = false;

// 1. INITIALIZATION
window.onload = () => {
    checkSession();
    initScrollReveal();
};

function showLoading(show) {
    document.getElementById("loadingOverlay").style.display = show ? "flex" : "none";
}

function checkSession() {
    const sessionNIK = sessionStorage.getItem("empNIK");
    if (sessionNIK) {
        document.getElementById("loginScreen").style.display = "none";
        document.getElementById("dashboardScreen").style.display = "flex";
        loadDashboard(sessionNIK);
    } else {
        document.getElementById("loginScreen").style.display = "flex";
        document.getElementById("dashboardScreen").style.display = "none";
    }
}

// 2. LOGIN LOGIC
async function loginKaryawan() {
    const nik = document.getElementById("loginNik").value.trim();
    const pin = document.getElementById("loginPin").value.trim();

    if (!nik || !pin) return alert("Nomor ID Karyawan dan PIN harus diisi!");

    showLoading(true);

    try {
        const { data, error } = await supabaseClient
            .from("karyawan")
            .select("*")
            .eq("nik", nik)
            .single();

        if (error || !data) throw new Error("Nomor ID Karyawan tidak ditemukan!");

        const validPin = data.pin ? data.pin : "123456";

        if (pin === validPin) {
            sessionStorage.setItem("empNIK", nik);
            checkSession();
        } else {
            alert("PIN Salah! Silakan coba lagi.");
        }
    } catch (e) {
        alert(e.message);
    } finally {
        showLoading(false);
    }
}

// 3. DASHBOARD DATA SYNC
async function loadDashboard(nik) {
    try {
        showLoading(true);

        // A. Fetch User Data
        const { data: user, error: errUser } = await supabaseClient
            .from("karyawan")
            .select("*")
            .eq("nik", nik)
            .single();

        if (errUser) throw errUser;
        currentUser = user;

        // B. Update UI Profile
        document.getElementById("userName").innerText = user.nama;
        document.getElementById("welcomeName").innerText = user.nama.split(' ')[0];
        document.getElementById("userDept").innerText = `${user.dept} • ${user.jabatan || '-'}`;
        document.getElementById("sisaCuti").innerText = user.sisa_cuti ?? 12;

        // Initial Avatar
        const initials = user.nama.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        document.getElementById("userInitial").innerText = initials;

        // C. Fetch Logs (Last 100 entries for current month)
        const { data: logs, error: errLogs } = await supabaseClient
            .from("logs")
            .select("*")
            .eq("nama", user.nama)
            .order("waktu", { ascending: false })
            .limit(100);

        if (errLogs) throw errLogs;
        currentLogs = logs || [];

        // D. Fetch approved & pending loans
        const { data: kasbon, error: errKasbon } = await supabaseClient
            .from("kasbon")
            .select("*")
            .eq("nik", nik)
            .order("id", { ascending: false });

        if (errKasbon) throw errKasbon;
        currentKasbon = kasbon || [];

        // E. Driver Section Check
        if (user.jabatan === "DRIVER") {
            const driverCard = document.getElementById("driverCard");
            if (driverCard) {
                driverCard.style.display = "block";
                initMapDriver();
            }
        }

        // F. Render Components
        renderHistory(currentLogs);
        renderEstimasiGaji(user, currentLogs, currentKasbon);
        renderKasbonStatus(currentKasbon);
        renderMOUStatus(user);

    } catch (e) {
        console.error("Dashboard Error:", e);
    } finally {
        showLoading(false);
    }
}

function renderHistory(logs) {
    const tbody = document.getElementById("historyTableBody");
    tbody.innerHTML = "";

    if (logs.length === 0) {
        tbody.innerHTML = "<tr><td colspan='3' style='text-align:center; padding: 40px; color: #94a3b8;'>Belum ada riwayat absensi.</td></tr>";
        return;
    }

    logs.slice(0, 7).forEach(l => {
        const waktu = new Date(l.waktu).toLocaleString("id-ID", {
            weekday: 'long',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        const statusClass = (l.status === "MASUK" || l.status === "BERANGKAT") ? "status-masuk" : "status-pulang";
        const lateBadge = l.isLate ? '<span class="badge-late">TELAT</span>' : '';

        tbody.innerHTML += `
            <tr>
                <td style="font-weight: 500;">${waktu}</td>
                <td><span class="status-pill ${statusClass}">${l.status}</span></td>
                <td>${lateBadge || '-'}</td>
            </tr>
        `;
    });
}

function renderKasbonStatus(kasbon) {
    const activeLoan = kasbon.filter(k => k.status === 'APPROVED').reduce((sum, k) => sum + parseFloat(k.nominal), 0);
    const pendingLoan = kasbon.filter(k => k.status === 'PENDING').reduce((sum, k) => sum + parseFloat(k.nominal), 0);

    document.getElementById("statusKasbon").innerText = `Rp ${activeLoan.toLocaleString("id-ID")}`;

    if (pendingLoan > 0) {
        document.getElementById("infoKasbon").innerHTML = `<span style="color: #f59e0b; font-weight: 600;">⚠️ Menunggu Persetujuan: Rp ${pendingLoan.toLocaleString("id-ID")}</span>`;
    } else if (activeLoan > 0) {
        document.getElementById("infoKasbon").innerText = "Pinjaman akan memotong gaji bulan ini.";
    } else {
        document.getElementById("infoKasbon").innerText = "Tidak ada pinjaman aktif.";
    }
}

// 4. PAYROLL FORMULA
function hitungDetailGaji(gapok, logsData, kasbonData) {
    const g = parseFloat(gapok) || 0;
    const standarHari = 24;
    const gajiHarian = g / standarHari;

    const ptkpStatus = currentUser?.status_ptkp || "TK/0";

    // Group logs by Date for Overtime (Only Current Month)
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const logsByDate = {};
    logsData.forEach(l => {
        const logDate = new Date(l.waktu);
        if (logDate.getMonth() === currentMonth && logDate.getFullYear() === currentYear) {
            const d = logDate.toLocaleDateString("id-ID");
            if (!logsByDate[d]) logsByDate[d] = [];
            logsByDate[d].push(l);
        }
    });

    const currentMonthLogs = logsData.filter(l => {
        const logDate = new Date(l.waktu);
        return logDate.getMonth() === currentMonth && logDate.getFullYear() === currentYear;
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
        const lastOut = [...dayLogs].reverse().find(l => l.status === "PULANG" || l.status === "KEMBALI" || l.status === "SAMPAI");

        if (firstIn && lastOut) {
            const lastOutDate = new Date(lastOut.waktu);
            const cutoff = new Date(lastOutDate);
            cutoff.setHours(18, 0, 0, 0); // Cutoff 18:00

            if (lastOutDate > cutoff) {
                const overtime = (lastOutDate - cutoff) / (1000 * 3600);
                totalJamLembur += overtime;
                totalLemburRp += overtime * 10000;
            }
        }
    });

    const jumlahTelat = currentMonthLogs.filter(
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

    // LOGIKA PTKP & PPh21
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
        gapok: g, gajiPro, hadir: hariHadir, jumlahTelat, potonganTelat,
        bpjsKes, jht, jp, pph21, kasbon: totalKasbon, bonusLembur: totalLemburRp,
        jamLembur: totalJamLembur, totalPotongan, thp: thp > 0 ? thp : 0,
        ptkpStatus, ptkpBulanan
    };
}

function renderEstimasiGaji(user, logsData, kasbonData) {
    const detail = hitungDetailGaji(user.gaji, logsData, kasbonData);
    document.getElementById("estimasiGaji").innerText = `Rp ${Math.floor(detail.thp).toLocaleString("id-ID")}`;
    
    // Tampilkan rincian lembur jika ada
    const overtimeInfo = document.getElementById("overtimeDetail");
    if (overtimeInfo) {
        if (detail.jamLembur > 0) {
            overtimeInfo.innerHTML = `Lembur: <strong>${detail.jamLembur.toFixed(1)} Jam</strong> (Rp ${detail.bonusLembur.toLocaleString("id-ID")})`;
            overtimeInfo.style.display = "block";
        } else {
            overtimeInfo.style.display = "none";
        }
    }
}

// 5. MODAL CONTROL
function bukaModal(id) {
    document.getElementById(id).classList.add('active');
}

function tutupModal(id) {
    document.getElementById(id).classList.remove('active');
}

// 6. FORM SUBMISSION
async function submitCuti() {
    const jenis = document.getElementById("inpJenisCuti").value;
    const mulai = document.getElementById("inpMulaiCuti").value;
    const selesai = document.getElementById("inpSelesaiCuti").value;
    const alasan = document.getElementById("inpAlasanCuti").value.trim();

    if (!mulai || !selesai || !alasan) return alert("Harap lengkapi semua data!");

    showLoading(true);
    try {
        const { error } = await supabaseClient.from("cuti_izin").insert([{
            nik: currentUser.nik,
            nama: currentUser.nama,
            jenis_pengajuan: jenis,
            tanggal_mulai: mulai,
            tanggal_selesai: selesai,
            alasan: alasan,
            status: "PENDING"
        }]);

        if (error) throw error;

        alert("Pengajuan berhasil dikirim! Menunggu persetujuan Admin.");
        tutupModal('modalCuti');
        loadDashboard(currentUser.nik);
    } catch (e) {
        alert("Gagal mengirim pengajuan: " + e.message);
    } finally {
        showLoading(false);
    }
}

async function submitKasbon() {
    const nominal = parseFloat(document.getElementById("inpNominalKasbon").value);
    const alasan = document.getElementById("inpAlasanKasbon").value.trim();

    if (!nominal || isNaN(nominal) || !alasan) return alert("Harap lengkapi nominal dan alasan!");

    showLoading(true);
    try {
        const { error } = await supabaseClient.from("kasbon").insert([{
            nik: currentUser.nik,
            nama: currentUser.nama,
            nominal: nominal,
            waktu_pengajuan: new Date().toISOString(),
            alasan: alasan,
            status: "PENDING"
        }]);

        if (error) throw error;

        alert("Pengajuan Kasbon berhasil dikirim! Menunggu persetujuan Admin.");
        tutupModal('modalKasbon');
        loadDashboard(currentUser.nik);
    } catch (e) {
        alert("Gagal mengirim pengajuan kasbon: " + e.message);
    } finally {
        showLoading(false);
    }
}

function downloadSlipPribadi() {
    if (!currentUser) return;
    const k = currentUser;
    const d = hitungDetailGaji(k.gaji, currentLogs, currentKasbon);
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
                <span>TOTAL KEHADIRAN</span><span>:</span><span>${d.hadir} / 24 Hari</span>
            </div>
    
            <div style="border-top:1px dashed #000; margin-top:15px; padding-top:10px;">
                <div style="display:flex; justify-content:space-between; font-size: 0.75rem;"><span>Gaji Pokok Full</span><span>Rp ${d.gapok.toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between; font-size: 0.75rem;"><span>Gaji Pro-rata (Hadir)</span><span>Rp ${Math.floor(d.gajiPro).toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between; color: #15803d; font-weight:bold; font-size: 0.75rem;"><span>Bonus Lembur (${d.jamLembur.toFixed(1)} Jam)</span><span>+Rp ${d.bonusLembur.toLocaleString("id-ID")}</span></div>
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
// 7. MOU & DIGITAL SIGNATURE
function renderMOUStatus(user) {
    const statusEl = document.getElementById("mouStatus");
    const dateEl = document.getElementById("mouDateInfo");
    const btnEl = document.getElementById("btnBukaMOU");

    if (user.mou_signed) {
        statusEl.innerText = "SUDAH TTD";
        statusEl.className = "mou-status-signed";
        dateEl.innerText = `Ditandatangani pada ${new Date(user.mou_date).toLocaleDateString('id-ID')}`;
        btnEl.innerText = "Lihat Kontrak (Signed)";
    } else {
        statusEl.innerText = "BELUM TTD";
        statusEl.className = "mou-status-pending";
        dateEl.innerText = "Harap segera lengkapi";
        btnEl.innerText = "Baca & Tanda Tangan";
    }
}

function bukaModalMOU() {
    const user = currentUser;

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
                    <div id="printSignatureArea" style="height: 60px; display: flex; justify-content: center; align-items: center; margin-bottom: 10px;">
                        <!-- Signature image injected here for printing -->
                    </div>
                    <p style="font-weight: bold; border-bottom: 1px solid #000; display: inline-block; padding: 0 10px;">( ${user.nama} )</p>
                </div>
            </div>
            
            <p style="font-size: 0.7rem; color: #64748b; margin-top: 50px; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
                Dokumen digital ini diterbitkan otomatis melalui KOBOI Apps dan bersifat mengikat secara hukum.
            </p>
        </div>
    `;

    document.getElementById("mouTextArea").innerHTML = bodyMOU;
    bukaModal('modalMOU');
    initSignaturePad();

    const btnPrint = document.getElementById("btnPrintMOU");
    if (user.mou_signed) {
        document.getElementById("signatureSection").style.display = "none";
        document.getElementById("btnSimpanMOU").style.display = "none";
        btnPrint.style.display = "inline-block";
        renderExistingSignature(user.mou_signature);

        // Prepare signature for print view
        const printSigArea = document.getElementById("printSignatureArea");
        printSigArea.innerHTML = `<img src="${user.mou_signature}" style="max-height: 80px; width: auto;">`;
    } else {
        document.getElementById("signatureSection").style.display = "block";
        document.getElementById("btnSimpanMOU").style.display = "block";
        btnPrint.style.display = "none";
    }
}

function cetakMOU() {
    const printContent = document.getElementById("mouPrintArea").innerHTML;
    const windowPrint = window.open('', '', 'width=900,height=900');
    windowPrint.document.write(`
        <html>
            <head>
                <title>MOU - ${currentUser.nama}</title>
                <style>
                    @page { size: A4; margin: 20mm; }
                    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; color: #000; -webkit-print-color-adjust: exact; }
                    img { max-width: 100%; }
                </style>
            </head>
            <body>
                ${printContent}
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

function initSignaturePad() {
    sigCanvas = document.getElementById("signaturePad");
    if (!sigCanvas) return console.error("Canvas signaturePad tidak ditemukan!");
    sigContext = sigCanvas.getContext("2d");

    // Gunakan timeout kecil untuk memastikan modal sudah ter-render sempurna
    setTimeout(() => {
        const rect = sigCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Set internal size
        sigCanvas.width = rect.width * dpr;
        sigCanvas.height = rect.height * dpr;

        // Set display size
        sigCanvas.style.width = rect.width + "px";
        sigCanvas.style.height = rect.height + "px";

        sigContext.scale(dpr, dpr);
        sigContext.strokeStyle = "#4f46e5";
        sigContext.lineWidth = 2;
        sigContext.lineCap = "round";
    }, 100);

    // Mouse / Touch events
    sigCanvas.addEventListener("mousedown", startDrawing);
    sigCanvas.addEventListener("mousemove", draw);
    sigCanvas.addEventListener("mouseup", stopDrawing);
    sigCanvas.addEventListener("touchstart", (e) => {
        const touch = e.touches[0];
        startDrawing({ offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top });
    });
    sigCanvas.addEventListener("touchmove", (e) => {
        const touch = e.touches[0];
        draw({ offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top });
        e.preventDefault();
    }, { passive: false });
    sigCanvas.addEventListener("touchend", stopDrawing);
}

function startDrawing(e) {
    isDrawing = true;
    sigContext.beginPath();
    sigContext.moveTo(e.offsetX, e.offsetY);
}

function draw(e) {
    if (!isDrawing) return;
    sigContext.lineTo(e.offsetX, e.offsetY);
    sigContext.stroke();
}

function stopDrawing() {
    isDrawing = false;
}

function clearSignature() {
    sigContext.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
}

function renderExistingSignature(base64) {
    if (!base64) return;
    const img = new Image();
    img.src = base64;
    img.onload = () => {
        sigContext.drawImage(img, 0, 0, sigCanvas.width / (window.devicePixelRatio || 1), sigCanvas.height / (window.devicePixelRatio || 1));
    }
}

async function saveMOU() {
    if (!currentUser) return alert("Sesi tidak valid, silakan login kembali.");
    if (!sigCanvas) return alert("Sistem tanda tangan belum siap.");

    if (!confirm("Apakah Anda yakin data tanda tangan sudah benar dan ingin menyetujui MOU ini?")) return;

    showLoading(true);
    try {
        const signatureData = sigCanvas.toDataURL("image/png");

        // Log untuk debug (bisa dihapus nanti)
        console.log("Saving MOU for:", currentUser.nik);

        const { error } = await supabaseClient
            .from("karyawan")
            .update({
                mou_signed: true,
                mou_signature: signatureData,
                mou_date: new Date().toISOString()
            })
            .eq("nik", currentUser.nik);

        if (error) {
            console.error("Supabase Update Error:", error);
            throw new Error(`Database Error: ${error.message} (${error.code || 'n/a'})`);
        }

        alert("MOU Berhasil ditandatangani! Terima kasih atas kerjasama Anda.");
        tutupModal('modalMOU');
        loadDashboard(currentUser.nik);
    } catch (e) {
        alert("Gagal menyimpan tanda tangan:\n" + e.message);
        console.error("Save MOU Catch:", e);
    } finally {
        showLoading(false);
    }
}

// 8. UI ENHANCEMENTS (PHASE 29)
function initScrollReveal() {
    const sections = document.querySelectorAll('.portal-section');

    const options = {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px"
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal');
            } else {
                // Jangan hapus reveal jika ingin tetap muncul setelah di-reveal
                // entry.target.classList.remove('reveal'); 
            }
        });
    }, options);

    sections.forEach(section => {
        observer.observe(section);
    });
}

// ============================================================
// DRIVER LOGISTICS FUNCTIONS
// ============================================================

function initMapDriver() {
    const mapEl = document.getElementById("mapDriver");
    if (!mapEl || mapDriver) return;

    // Default location (Jakarta) until GPS kicks in
    mapDriver = L.map("mapDriver").setView([-6.2, 106.816], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(mapDriver);

    // Try to get the driver's current position
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                mapDriver.setView([lat, lng], 15);
                markerDriver = L.marker([lat, lng]).addTo(mapDriver)
                    .bindPopup("Posisi Anda saat ini").openPopup();
            },
            (err) => {
                console.warn("GPS Error:", err.message);
                document.getElementById("lastCheckIn").innerText = "⚠️ Gagal mengakses GPS. Pastikan izin lokasi diaktifkan.";
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    } else {
        document.getElementById("lastCheckIn").innerText = "⚠️ Browser Anda tidak mendukung GPS.";
    }

    // Fix map render issue in hidden containers
    setTimeout(() => mapDriver.invalidateSize(), 300);
}

async function checkInLokasi() {
    const lokasiInput = document.getElementById("lokasiTujuan");
    const statusEl = document.getElementById("lastCheckIn");
    const keterangan = lokasiInput.value.trim();

    if (!keterangan) {
        alert("Silakan isi nama lokasi/tujuan terlebih dahulu.");
        return;
    }

    if (!currentUser) {
        alert("Sesi login tidak ditemukan. Silakan login ulang.");
        return;
    }

    statusEl.innerText = "⏳ Mengirim data lokasi...";

    try {
        const pos = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("GPS tidak tersedia di browser ini."));
                return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 15000
            });
        });

        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        const { error } = await supabaseClient
            .from("delivery_logs")
            .insert({
                nik: currentUser.nik,
                nama: currentUser.nama,
                keterangan: keterangan,
                latitude: lat,
                longitude: lng
            });

        if (error) throw error;

        // Update marker on map
        if (markerDriver) {
            mapDriver.removeLayer(markerDriver);
        }
        markerDriver = L.marker([lat, lng]).addTo(mapDriver)
            .bindPopup(`<b>${keterangan}</b><br>${new Date().toLocaleTimeString("id-ID")}`).openPopup();
        mapDriver.setView([lat, lng], 15);

        // Clear input and show success
        lokasiInput.value = "";
        statusEl.innerText = `✅ Check-in "${keterangan}" berhasil pada ${new Date().toLocaleTimeString("id-ID")}`;

    } catch (err) {
        console.error("Check-in Error:", err);
        if (err.code === 1) {
            statusEl.innerText = "❌ Izin lokasi ditolak. Aktifkan GPS di pengaturan browser Anda.";
        } else if (err.code === 3) {
            statusEl.innerText = "❌ Timeout GPS. Coba pindah ke tempat terbuka dan ulangi.";
        } else {
            statusEl.innerText = "❌ Gagal check-in: " + err.message;
        }
    }
}
