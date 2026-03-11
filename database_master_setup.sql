-- ==========================================
-- PT. KOLA BORASI INDONESIA - MASTER DATABASE SETUP
-- Dashboard HRIS & Employee Portal (Revised 2026)
-- ==========================================

-- 1. TABEL: cuti_izin (Jika belum ada)
CREATE TABLE IF NOT EXISTS cuti_izin (
    id SERIAL PRIMARY KEY,
    nik VARCHAR NOT NULL,
    nama VARCHAR NOT NULL,
    jenis_pengajuan VARCHAR NOT NULL, -- Pilihan: 'CUTI', 'IZIN', 'SAKIT'
    tanggal_mulai DATE NOT NULL,
    tanggal_selesai DATE NOT NULL,
    alasan TEXT,
    status VARCHAR DEFAULT 'PENDING', -- Pilihan: 'PENDING', 'APPROVED', 'REJECTED'
    waktu_pengajuan TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. TABEL: kasbon (Jika belum ada)
CREATE TABLE IF NOT EXISTS kasbon (
    id SERIAL PRIMARY KEY,
    nik VARCHAR NOT NULL,
    nama VARCHAR NOT NULL,
    nominal NUMERIC NOT NULL,
    alasan TEXT,
    status VARCHAR DEFAULT 'PENDING', -- Pilihan: 'PENDING', 'APPROVED', 'REJECTED'
    waktu_pengajuan TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. EKSPANSI TABEL: karyawan (Pastikan kolom baru ada)
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS pin VARCHAR DEFAULT '123456';
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS sisa_cuti INT DEFAULT 12;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS jabatan VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS gaji NUMERIC DEFAULT 0;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS tahun_bergabung VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS nik_ktp VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS npwp VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS status_ptkp VARCHAR;

-- 4. KEAMANAN: Aktifkan RLS untuk semua tabel
ALTER TABLE karyawan ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuti_izin ENABLE ROW LEVEL SECURITY;
ALTER TABLE kasbon ENABLE ROW LEVEL SECURITY;

-- 5. KEAMANAN: Kebijakan (Policies) agar aplikasi bisa akses (Akses Anonim)
-- Kebijakan 'karyawan'
DROP POLICY IF EXISTS "Allow all for anon" ON karyawan;
CREATE POLICY "Allow all for anon" ON karyawan FOR ALL TO anon USING (true) WITH CHECK (true);

-- Kebijakan 'logs'
DROP POLICY IF EXISTS "Allow all for anon" ON logs;
CREATE POLICY "Allow all for anon" ON logs FOR ALL TO anon USING (true) WITH CHECK (true);

-- Kebijakan 'cuti_izin'
DROP POLICY IF EXISTS "Allow all for anon" ON cuti_izin;
CREATE POLICY "Allow all for anon" ON cuti_izin FOR ALL TO anon USING (true) WITH CHECK (true);

-- Kebijakan 'kasbon'
DROP POLICY IF EXISTS "Allow all for anon" ON kasbon;
CREATE POLICY "Allow all for anon" ON kasbon FOR ALL TO anon USING (true) WITH CHECK (true);

-- ==========================================
-- SETUP SELESAI
-- ==========================================
