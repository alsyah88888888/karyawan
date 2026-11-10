
const { createClient } = require('@supabase/supabase-js');

const SB_URL = "https://ulmwpmzcaiuyubgehptt.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsbXdwbXpjYWl1eXViZ2VocHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MzI2MjUsImV4cCI6MjA4NzQwODYyNX0._Y2MkIiRDM52CVMsZEp-lSRBQ93ZYGkwkFbmxfZ5tFo";
const supabase = createClient(SB_URL, SB_KEY);

async function checkLogs() {
    const today = new Date();
    today.setHours(0,0,0,0);
    const todayISO = today.toISOString();

    console.log("Checking logs for today:", todayISO);

    const { data, error } = await supabase
        .from('logs')
        .select('*')
        .gte('waktu', todayISO)
        .order('waktu', { ascending: false });

    if (error) {
        console.error("Error fetching logs:", error);
        return;
    }

    console.log(`Found ${data.length} logs for today.`);
    data.forEach(log => {
        console.log(`${log.nama} | ${log.status} | ${log.waktu}`);
    });
}

checkLogs();
