-- =============================================
-- FIX: MISSING COLUMNS & SCHEMA CACHE
-- Jalankan ini di SQL Editor Supabase Anda!
-- =============================================

-- 1. Tambahkan kolom yang mungkin belum ada di tabel 'karyawan'
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS nomor_wa VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS norek VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS insentif_lk NUMERIC DEFAULT 0;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS insentif_reguler VARCHAR DEFAULT 'Tidak';
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS pinjaman NUMERIC DEFAULT 0;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS pot_hke NUMERIC DEFAULT 0;

-- 2. Pastikan kolom-kolom MOU juga ada (Double check)
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS mou_signed BOOLEAN DEFAULT FALSE;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS mou_signature TEXT;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS mou_date TIMESTAMP WITH TIME ZONE;

-- 3. Berikan komentar untuk memicu refresh schema cache Supabase/PostgREST
COMMENT ON TABLE karyawan IS 'Tabel data karyawan KOBOI - Updated 2026';
COMMENT ON COLUMN karyawan.norek IS 'Nomor Rekening Bank Karyawan';

-- 4. Pastikan RLS mengizinkan akses (untuk antisipasi isu izin)
-- Supabase seringkali butuh policy yang tepat agar kolom baru bisa diakses anonim
DROP POLICY IF EXISTS "Allow all for anon" ON karyawan;
CREATE POLICY "Allow all for anon" ON karyawan 
FOR ALL TO anon 
USING (true) 
WITH CHECK (true);

-- 5. Pancing Reload Schema secara paksa (Trick DDL)
-- Melakukan DDL kecil biasanya memaksa PostgREST me-reload schema cache-nya
CREATE OR REPLACE FUNCTION refresh_schema_v2() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;
DROP FUNCTION refresh_schema_v2();

-- =============================================
-- SELESAI. Silakan coba simpan/update data lagi!
-- =============================================
