-- Menambahkan kolom untuk fitur MOU / Kontrak Kerja
ALTER TABLE karyawan 
ADD COLUMN IF NOT EXISTS mou_signed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS mou_signature TEXT, -- Menyimpan data Base64 tanda tangan
ADD COLUMN IF NOT EXISTS mou_date TIMESTAMP WITH TIME ZONE;

-- Berikan akses ke kolom baru jika ada RLS
-- (Biasanya kolom baru otomatis mengikuti kebijakan tabel yang sudah ada)

COMMENT ON COLUMN karyawan.mou_signature IS 'Data gambar tanda tangan dalam format Base64';
COMMENT ON COLUMN karyawan.mou_signed IS 'Status apakah karyawan sudah menyetujui MOU online';
