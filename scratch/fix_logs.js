const { createClient } = require('@supabase/supabase-js');
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabase = createClient(SB_URL, SB_KEY);

async function fix() {
  console.log("Mencari log yang perlu diperbaiki...");
  
  // Ambil log Tatang, Heru, Wawan di jam dini hari tgl 16 Mei
  const { data: logs, error } = await supabase
    .from('logs')
    .select('id, nama, waktu')
    .in('nama', ['TATANG', 'HERU', 'WAWAN KURNIAAWAN', 'WAWAN KURNIAWAN'])
    .gte('waktu', '2026-05-15T17:00:00Z') // Jam 00:00 WIB tgl 16
    .lte('waktu', '2026-05-15T22:00:00Z'); // Jam 05:00 WIB tgl 16

  if (error) {
    console.error("Gagal ambil data:", error);
    return;
  }

  console.log(`Ditemukan ${logs.length} log untuk diperbaiki.`);

  for (const l of logs) {
    const oldDate = new Date(l.waktu);
    // Kurangi 7 jam (mengembalikan pergeseran zona waktu)
    const newDate = new Date(oldDate.getTime() - 7 * 60 * 60 * 1000);
    
    console.log(`Memperbaiki ${l.nama}: ${l.waktu} -> ${newDate.toISOString()}`);
    
    const { error: upErr } = await supabase
      .from('logs')
      .update({ waktu: newDate.toISOString() })
      .eq('id', l.id);
      
    if (upErr) console.error(`Gagal update ID ${l.id}:`, upErr);
  }
  
  console.log("Selesai!");
}

fix();
