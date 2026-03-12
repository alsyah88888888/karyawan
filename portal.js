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

function logoutKaryawan() {
    if(confirm("Yakin ingin keluar?")) {
        sessionStorage.removeItem("empNIK");
        window.location.reload();
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
        const initials = user.nama.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
        document.getElementById("userInitial").innerText = initials;

        // C. Fetch Logs (Last 30 Days)
        const { data: logs, error: errLogs } = await supabaseClient
            .from("logs")
            .select("*")
            .eq("nama", user.nama)
            .order("waktu", { ascending: false })
            .limit(30);

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

        // E. Render Components
        renderHistory(currentLogs);
        renderEstimasiGaji(user, currentLogs, currentKasbon);
        renderKasbonStatus(currentKasbon);
        renderMOUStatus(user);

    } catch (e) {
        console.error("Dashboard Error:", e);
        // Jangan logout otomatis agar tidak terjadi refresh paksa saat koneksi buruk
        // alert("Gagal memuat data dashboard terbaru. Cek koneksi Anda."); 
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
    const standarHari = 22;
    const gajiHarian = g / standarHari;

    const ptkpStatus = currentUser?.status_ptkp || "TK/0";

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
        const dayLogs = logsByDate[date].sort((a,b) => new Date(a.waktu) - new Date(b.waktu));
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
    } catch(e) {
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
    } catch(e) {
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
    
    const isiSlip = `
        <div style="width: 450px; padding: 30px; border: 1px solid #000; font-family: 'Courier New', monospace; background: #fff; color: #000;">
            <h2 style="text-align:center; margin:0;">PT. KOLA BORASI INDONESIA</h2>
            <p style="text-align:center; border-bottom: 2px solid #000; padding-bottom:10px; font-weight:bold;">SLIP GAJI (E-PORTAL) - ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}</p>
            
            <div style="display:grid; grid-template-columns: 130px 10px 1fr; line-height: 1.6; font-size:0.85rem;">
                <span>ID KARYAWAN</span><span>:</span><span>${k.nik || "-"}</span>
                <span>NAMA</span><span>:</span><span>${k.nama}</span>
                <span>STATUS PAJAK</span><span>:</span><span>${d.ptkpStatus}</span>
                <span>JABATAN</span><span>:</span><span>${k.jabatan || k.dept}</span>
                <span>KEHADIRAN</span><span>:</span><span>${d.hadir} / 22 Hari</span>
            </div>
    
            <div style="border-top:1px dashed #000; margin-top:15px; padding-top:10px;">
                <div style="display:flex; justify-content:space-between;"><span>Gaji Pokok Full</span><span>Rp ${d.gapok.toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>Gaji Pro-rata</span><span>Rp ${Math.floor(d.gajiPro).toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between; color: #15803d; font-weight:bold;"><span>Bonus Lembur (${d.jamLembur} Jam)</span><span>+Rp ${d.bonusLembur.toLocaleString("id-ID")}</span></div>
            </div>
    
            <p style="margin: 10px 0 5px 0; font-weight:bold; text-decoration: underline;">POTONGAN & PAJAK</p>
            <div style="line-height: 1.4; font-size:0.8rem;">
                <div style="display:flex; justify-content:space-between;"><span>BPJS Kesehatan (1%)</span><span>-Rp ${Math.floor(d.bpjsKes).toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>JHT (2%)</span><span>-Rp ${Math.floor(d.jht).toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>JP (1%)</span><span>-Rp ${Math.floor(d.jp).toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>PPh 21 (PKP > 0)</span><span>-Rp ${Math.floor(d.pph21).toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between; color: red;"><span>Potongan Telat (${d.jumlahTelat}x)</span><span>-Rp ${Math.floor(d.potonganTelat).toLocaleString("id-ID")}</span></div>
                <div style="display:flex; justify-content:space-between; font-weight:bold; color:#1e293b; border-top:1px dashed #ccc; margin-top:5px; padding-top:5px;"><span>POTONGAN KASBON</span><span>-Rp ${d.kasbon.toLocaleString("id-ID")}</span></div>
            </div>
    
            <div style="border-top:2px solid #000; margin-top:15px; padding:10px 0; display:flex; justify-content:space-between; font-weight:bold; font-size:1.1rem; background:#f9f9f9;">
                <span>TAKE HOME PAY</span><span>Rp ${Math.floor(d.thp).toLocaleString("id-ID")}</span>
            </div>
            
            <p style="text-align:center; font-size:0.7rem; margin-top:20px; font-style: italic;">Dicetak via KOBOI Portal pada ${tgl.toLocaleString("id-ID")}</p>
        </div>`;
    
    const w = window.open("", "_blank");
    if (w) {
        w.document.write(`<html><body style="display:flex;justify-content:center;padding:20px;">${isiSlip}<script>window.onload=function(){window.print();}<\/script></body></html>`);
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
    const bodyMOU = `
        <div style="text-align:justify;">
            <p style="text-align:center; font-weight:800; font-size:1.1rem;">SURAT PERJANJIAN KERJA (MEMORANDUM OF UNDERSTANDING)</p>
            <p style="text-align:center; margin-bottom:30px;">Nomor: MOU/KBI/${user.nik}/${new Date().getFullYear()}</p>
            
            <p>Yang bertanda tangan di bawah ini:</p>
            <div style="margin-left:20px; margin-bottom:15px;">
                <strong>1. PT. KOLA BORASI INDONESIA</strong>, berkedudukan di Jakarta, dalam hal ini diwakili oleh Manajemen HRD, selanjutnya disebut <strong>"PIHAK PERTAMA"</strong>.<br>
                <strong>2. ${user.nama}</strong>, ID: ${user.nik}, beralamat sesuai data identitas, dalam hal ini bertindak untuk diri sendiri, selanjutnya disebut <strong>"PIHAK KEDUA"</strong>.
            </div>

            <p>KEDUA BELAH PIHAK dengan ini sepakat untuk mengikatkan diri dalam Perjanjian Hubungan Kerja dengan ketentuan sebagai berikut:</p>
            
            <p><strong>PASAL 1: JURUSAN & TANGGUNG JAWAB</strong><br>
            PIHAK KEDUA bekerja sebagai <strong>${user.jabatan || user.dept}</strong> pada departemen <strong>${user.dept}</strong> dan bersedia melaksanakan tugas dengan penuh tanggung jawab sesuai arahan perusahaan.</p>

            <p><strong>PASAL 2: UPAH & TUNJANGAN</strong><br>
            PIHAK PERTAMA sepakat memberikan upah pokok sebesar <strong>Rp ${user.gaji.toLocaleString('id-ID')}</strong> per bulan, yang dibayarkan setiap akhir bulan berjalan melalui sistem KOBOI Apps.</p>

            <p><strong>PASAL 3: KEDISIPLINAN</strong><br>
            PIHAK KEDUA wajib mengikuti aturan jam kerja perusahaan (9 jam kerja) dan sistem absensi real-time. Pelanggaran terhadap jam kerja akan dikenakan sanksi pro-rata atau pemotongan sesuai sistem.</p>

            <p><strong>PASAL 4: JANGKA WAKTU</strong><br>
            Perjanjian ini berlaku sejak tanggal bergabung hingga diputuskan oleh salah satu pihak sesuai dengan kebijakan internal PT. Kola Borasi Indonesia.</p>

            <p style="margin-top:30px;">Demikian Surat Perjanjian ini dibuat untuk dipatuhi oleh kedua belah pihak secara digital tanpa ada paksaan dari pihak manapun.</p>
        </div>
    `;

    document.getElementById("mouTextArea").innerHTML = bodyMOU;
    bukaModal('modalMOU');
    initSignaturePad();

    if (user.mou_signed) {
        document.getElementById("signatureSection").style.display = "none";
        document.getElementById("btnSimpanMOU").style.display = "none";
        renderExistingSignature(user.mou_signature);
    } else {
        document.getElementById("signatureSection").style.display = "block";
        document.getElementById("btnSimpanMOU").style.display = "block";
    }
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
    if(!base64) return;
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
