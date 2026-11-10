
const { createClient } = require('@supabase/supabase-js');

const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabase = createClient(SB_URL, SB_KEY);

async function checkAbdurrokhman() {
    const { data: logs, error } = await supabase
        .from('logs')
        .select('*')
        .ilike('nama', '%ABDURROKHMAN%')
        .order('waktu', { ascending: true });

    if (error) {
        console.error("Error fetching logs:", error);
        return;
    }

    console.log("LOGS FOR ABDURROKHMAN:");
    console.table(logs.map(l => ({
        id: l.id,
        nama: l.nama,
        waktu: l.waktu,
        status: l.status,
        dept: l.dept
    })));
}

checkAbdurrokhman();
