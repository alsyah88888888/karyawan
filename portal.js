const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let currentLogs = [];

window.onload = () => {
    checkSession();
};

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

async function loginKaryawan() {
    const nik = document.getElementById("loginNik").value.trim();
    const pin = document.getElementById("loginPin").value.trim();

    if (!nik || !pin) return alert("NIK dan PIN harus diisi!");

    document.querySelector(".login-section button").innerText = "MEMERIKSA...";

    try {
        const { data, error } = await supabaseClient
            .from("karyawan")
            .select("*")
            .eq("nik", nik)
            .single();

        if (error || !data) throw new Error("NIK tidak ditemukan!");

        const validPin = data.pin ? data.pin : "123456"; // Default PIN if none set in DB yet

        if (pin === validPin) {
            sessionStorage.setItem("empNIK", nik);
            checkSession();
        } else {
            alert("PIN Salah! Coba lagi.");
        }
    } catch (e) {
        alert(e.message);
    } finally {
        document.querySelector(".login-section button").innerText = "MASUK";
    }
}

function logoutKaryawan() {
    sessionStorage.removeItem("empNIK");
    checkSession();
}

async function loadDashboard(nik) {
    try {
        // 1. Fetch User Data
        const { data: user, error: errUser } = await supabaseClient
            .from("karyawan")
            .select("*")
            .eq("nik", nik)
            .single();
        
        if (errUser) throw errUser;
        currentUser = user;

        document.getElementById("userName").innerText = user.nama;
        document.getElementById("userDept").innerText = user.jabatan || user.dept;
        document.getElementById("sisaCuti").innerHTML = `${user.sisa_cuti ?? 12} <span style="font-size:1rem; color:#64748b; font-weight:600;">Hari</span>`;

        // 2. Fetch User Logs
        const { data: logs, error: errLogs } = await supabaseClient
            .from("logs")
            .select("*")
            .eq("nama", user.nama)
            .order("waktu", { ascending: false })
            .limit(30);

        if (errLogs) throw errLogs;
        currentLogs = logs || [];

        renderHistory(currentLogs);
        renderEstimasiGaji(user, currentLogs);

    } catch (e) {
        console.error("Gagal muat dashboard:", e);
        alert("Sesi kadaluarsa atau terjadi kesalahan.");
        logoutKaryawan();
    }
}

function renderHistory(logs) {
    const tbody = document.getElementById("historyTableBody");
    tbody.innerHTML = "";

    if (logs.length === 0) {
        tbody.innerHTML = "<tr><td colspan='3' style='text-align:center;'>Belum ada riwayat absensi.</td></tr>";
        return;
    }

    logs.slice(0, 7).forEach(l => {
        const waktu = new Date(l.waktu).toLocaleString("id-ID");
        const sClass = (l.status === "MASUK" || l.status === "BERANGKAT") ? "color:#15803d; font-weight:bold;" : "color:#4338ca; font-weight:bold;";
        const isLate = l.isLate ? "Ya" : "-";
        
        tbody.innerHTML += `
            <tr>
                <td>${waktu}</td>
                <td style="${sClass}">${l.status}</td>
                <td><span style="${l.isLate ? 'color:red;font-weight:bold;' : ''}">${isLate}</span></td>
            </tr>
        `;
    });
}

function hitungDetailGaji(gapok, logsData) {
    const g = parseFloat(gapok) || 0;
    const standarHari = 22;
    const gajiHarian = g / standarHari;

    const hariHadir = [
        ...new Set(
            logsData
                .filter((l) => l.status === "MASUK" || l.status === "BERANGKAT")
                .map((l) => new Date(l.waktu).toLocaleDateString()),
        ),
    ].length;

    const jumlahTelat = logsData.filter(
        (l) => (l.status === "MASUK" || l.status === "BERANGKAT") && (l.isLate === true || l.is_late === true),
    ).length;

    const gajiPro = (hariHadir / standarHari) * g;
    const potonganTelat = jumlahTelat * (gajiHarian * 0.02); 

    const bpjsKes = gajiPro * 0.01;
    const jht = gajiPro * 0.02;
    const jp = gajiPro * 0.01;
    const pph21 = gajiPro * 0.015;

    const totalPotongan = bpjsKes + jht + jp + pph21 + potonganTelat;
    const thp = gajiPro - totalPotongan;

    return {
        gapok: g, gajiPro, hadir: hariHadir, jumlahTelat, potonganTelat,
        bpjsKes, jht, jp, pph21, totalPotongan, thp: thp > 0 ? thp : 0,
    };
}

function renderEstimasiGaji(user, logsData) {
    const detail = hitungDetailGaji(user.gaji, logsData);
    document.getElementById("estimasiGaji").innerText = `Rp ${Math.floor(detail.thp).toLocaleString("id-ID")}`;
}

function downloadSlipPribadi() {
    if (!currentUser) return;
    const k = currentUser;
    const d = hitungDetailGaji(k.gaji, currentLogs);
    const tgl = new Date();
    const bulanIndo = [
        "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
        "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"
    ];
    
    // (We reuse the beautiful slip generator logic from admin panel)
    const isiSlip = `
        <div style="width: 450px; padding: 30px; border: 1px solid #000; font-family: 'Courier New', monospace; background: #fff; color: #000;">
            <h2 style="text-align:center; margin:0;">PT. KOLA BORASI INDONESIA</h2>
            <p style="text-align:center; border-bottom: 2px solid #000; padding-bottom:10px; font-weight:bold;">SLIP GAJI - ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}</p>
            
            <div style="display:grid; grid-template-columns: 120px 10px 1fr; line-height: 1.6;">
                <span>ID KARYAWAN</span><span>:</span><span>${k.nik || "-"}</span>
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
            
            <p style="text-align:center; font-size:0.7rem; margin-top:20px; font-style: italic;">Dicetak oleh Karyawan (ESS) pada ${tgl.toLocaleString("id-ID")}</p>
        </div>`;
    
    const w = window.open("", "_blank");
    w.document.write(
        `<html><body style="display:flex;justify-content:center;padding:20px;">${isiSlip}<script>window.onload=function(){window.print();}<\/script></body></html>`,
    );
    w.document.close();
}
