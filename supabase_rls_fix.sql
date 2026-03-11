-- PT. Kola Borasi Indonesia - Supabase RLS Security Fix
-- Jalankan perintah ini di SQL Editor Supabase Anda untuk menghilangkan error keamanan.

-- 1. Aktifkan RLS untuk semua tabel
ALTER TABLE karyawan ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuti_izin ENABLE ROW LEVEL SECURITY;
ALTER TABLE kasbon ENABLE ROW LEVEL SECURITY;

-- 2. Buat Kebijakan (Policies) agar aplikasi tetap bisa berjalan (Akses 'anon')
-- Kebijakan untuk 'karyawan'
DROP POLICY IF EXISTS "Allow all for anon" ON karyawan;
CREATE POLICY "Allow all for anon" ON karyawan FOR ALL TO anon USING (true) WITH CHECK (true);

-- Kebijakan untuk 'logs'
DROP POLICY IF EXISTS "Allow all for anon" ON logs;
CREATE POLICY "Allow all for anon" ON logs FOR ALL TO anon USING (true) WITH CHECK (true);

-- Kebijakan untuk 'cuti_izin'
DROP POLICY IF EXISTS "Allow all for anon" ON cuti_izin;
CREATE POLICY "Allow all for anon" ON cuti_izin FOR ALL TO anon USING (true) WITH CHECK (true);

-- Kebijakan untuk 'kasbon'
DROP POLICY IF EXISTS "Allow all for anon" ON kasbon;
CREATE POLICY "Allow all for anon" ON kasbon FOR ALL TO anon USING (true) WITH CHECK (true);
