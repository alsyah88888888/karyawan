-- Menambahkan kolom nomor_wa ke tabel karyawan
-- Digunakan untuk fitur pengiriman slip gaji otomatis via WhatsApp

ALTER TABLE karyawan 
ADD COLUMN IF NOT EXISTS nomor_wa TEXT;

COMMENT ON COLUMN karyawan.nomor_wa IS 'Nomor WhatsApp karyawan untuk pengiriman slip gaji';

-- Refresh cache schema
NOTIFY pgrst, 'reload schema';
