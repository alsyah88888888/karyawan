-- Migration 0016: Menambahkan kolom tarif_lembur kustom pada tabel karyawan
-- Jika kolom ini tidak diisi (null / 0), sistem otomatis menghitung tarif lembur proporsional:
-- 1. Karyawan Non-Admin: Rumus resmi Ketenagakerjaan (PP 35/2021) = 1/173 x Gaji Pokok
-- 2. Karyawan Admin: Rp 10.000 / jam (maksimal 1 jam per hari) sesuai instruksi manajemen

alter table public.karyawan
  add column if not exists tarif_lembur numeric default null;
