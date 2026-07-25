// Normalisasi nama sebelum dibandingkan lintas tabel (karyawan.nama vs
// logs.nama) - data nyata pernah ditemukan nama dengan spasi nyasar (mis.
// "ANDI SETIANDI " di tabel karyawan), yang kalau dibandingkan apa adanya
// bisa salah anggap orang yang sudah absen sebagai "belum absen" gara-gara
// beda spasi/huruf besar-kecil semata. Spasi ganda di tengah juga dirapikan
// (bukan cuma trim ujung), untuk jaga-jaga kesalahan input serupa.
export function normalisasiNama(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
