-- ==========================================
-- FINAL SCHEMA CACHE REFRESH & COLUMN FIX
-- Jalankan ini di SQL Editor Supabase
-- ==========================================

-- 1. Pastikan kolom ada (Jika belum ada)
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS nik_ktp VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS npwp VARCHAR;
ALTER TABLE karyawan ADD COLUMN IF NOT EXISTS status_ptkp VARCHAR;

-- 2. "Pancing" Reload Cache dengan melakukan hal kecil
-- (Menambahkan deskripsi/comment biasanya memaksa PostgREST reload schema)
COMMENT ON COLUMN karyawan.nik_ktp IS 'Nomor Induk Kependudukan dari KTP';
COMMENT ON COLUMN karyawan.npwp IS 'Nomor Pokok Wajib Pajak';
COMMENT ON COLUMN karyawan.status_ptkp IS 'Status Penghasilan Tidak Kena Pajak';

-- 3. Trigger manual reload schema (Trick)
-- Kita buat function kosong dan hapus lagi
CREATE OR REPLACE FUNCTION reload_schema_trigger() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;
DROP FUNCTION reload_schema_trigger();

-- ==========================================
-- SELESAI. Silakan coba input data lagi.
-- ==========================================
