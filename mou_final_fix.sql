-- =============================================
-- MOU FINAL FIX: SCHEMA, CACHE & RLS
-- Jalankan ini di SQL Editor Supabase mas!
-- =============================================

-- 1. Pastikan kolom-kolom MOU ada
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS mou_signed BOOLEAN DEFAULT FALSE;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS mou_signature TEXT;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS mou_date TIMESTAMP WITH TIME ZONE;

-- 2. Berikan komentar untuk memancing refresh schema cache
COMMENT ON COLUMN karyawan.mou_signed IS 'Status persetujuan MOU digital';
COMMENT ON COLUMN karyawan.mou_signature IS 'Base64 data tanda tangan karyawan';
COMMENT ON COLUMN karyawan.mou_date IS 'Waktu penandatanganan MOU';

-- 3. Pastikan RLS mengizinkan update oleh anon (sesuai setup aplikasi)
-- Kita hapus dan buat ulang policy agar segar
DROP POLICY IF EXISTS "Allow all for anon" ON karyawan;
CREATE POLICY "Allow all for anon" ON karyawan 
FOR ALL TO anon 
USING (true) 
WITH CHECK (true);

-- 4. Pancing Reload Schema secara paksa (Trick)
CREATE OR REPLACE FUNCTION refresh_mou_schema() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;
DROP FUNCTION refresh_mou_schema();

-- =============================================
-- SELESAI. Silakan coba tanda tangan lagi mas!
-- =============================================
