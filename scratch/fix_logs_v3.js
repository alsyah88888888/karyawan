const { createClient } = require('@supabase/supabase-js');
const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabase = createClient(SB_URL, SB_KEY);

async function fix() {
  const targetNames = [
    'TATANG', 'HERU', 'WAWAN KURNIAWAN', 'WAWAN KURNIAAWAN', 
    'AHMAD RIYADI', 'ABDURROKHMAN', 'CAHYO ADI TRISNANTO', 
    'RAHMAT HIDAYAT', 'KARNO'
  ];
  
  console.log("Mengoreksi log ke jam 22:46 (16 Mei)...");
  
  // Ambil log terbaru dari nama-nama tersebut
  const { data: logs, error } = await supabase
    .from('logs')
    .select('id, nama, waktu')
    .in('nama', targetNames)
    .gte('waktu', '2026-05-14T00:00:00Z') // Ambil log 2 hari terakhir
    .order('id', { ascending: false });

  if (error) return console.error(error);

  // Kita gunakan Map untuk memastikan kita hanya mengupdate 1 log PULANG terbaru per orang untuk hari ini
  const updated = new Set();

  for (const l of logs) {
    if (!updated.has(l.nama)) {
      const fixedTime = "2026-05-16T22:46:00"; 
      console.log(`Mengoreksi ${l.nama}: ID ${l.id} -> ${fixedTime}`);
      
      await supabase
        .from('logs')
        .update({ waktu: fixedTime })
        .eq('id', l.id);
        
      updated.add(l.nama);
    }
  }
  
  console.log("Koreksi Selesai!");
}

fix();
