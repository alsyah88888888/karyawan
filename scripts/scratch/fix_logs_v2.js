const { createClient } = require('@supabase/supabase-js');
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabase = createClient(SB_URL, SB_KEY);

async function fix() {
  console.log("Memperbaiki log Tatang, Heru, Wawan ke jam 22:46 WIB...");
  
  // Ambil log terbaru hari ini (16 Mei)
  const { data: logs, error } = await supabase
    .from('logs')
    .select('id, nama, waktu')
    .in('nama', ['TATANG', 'HERU', 'WAWAN KURNIAWAN', 'WAWAN KURNIAAWAN'])
    .order('id', { ascending: false })
    .limit(5);

  if (error) return console.error(error);

  for (const l of logs) {
    // Kita set ke 2026-05-16 jam 22:46:00 (WIB)
    // Karena sekarang sistem menggunakan "Literal Local Time", kita simpan string-nya saja
    const fixedTime = "2026-05-16T22:46:00"; 
    
    console.log(`Mengoreksi ${l.nama}: ID ${l.id} -> ${fixedTime}`);
    
    await supabase
      .from('logs')
      .update({ waktu: fixedTime })
      .eq('id', l.id);
  }
  
  console.log("Koreksi Selesai!");
}

fix();
