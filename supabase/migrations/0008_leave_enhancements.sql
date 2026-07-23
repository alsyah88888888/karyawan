-- ============================================================================
-- PENGEMBANGAN PENGAJUAN CUTI: lampiran bukti, alasan penolakan.
-- Cara pakai: Supabase Dashboard > SQL Editor, tempel, Run.
-- ============================================================================

alter table public.leave_requests
  add column if not exists attachment_url text,
  add column if not exists rejection_reason text;

-- Bucket untuk lampiran (surat dokter, dsb). TIDAK public - dokumen pribadi
-- karyawan, cuma boleh dibaca oleh pemiliknya sendiri dan admin/super_admin.
insert into storage.buckets (id, name, public)
values ('leave-attachments', 'leave-attachments', false)
on conflict (id) do nothing;

drop policy if exists "user uploads own leave attachment" on storage.objects;
create policy "user uploads own leave attachment"
on storage.objects for insert
to public
with check (
  bucket_id = 'leave-attachments'
  and (
    (auth.jwt()->>'app_role') in ('admin', 'super_admin')
    or (storage.foldername(name))[1] = (auth.jwt()->>'karyawan_id')
  )
);

drop policy if exists "user reads own leave attachment" on storage.objects;
create policy "user reads own leave attachment"
on storage.objects for select
to public
using (
  bucket_id = 'leave-attachments'
  and (
    (auth.jwt()->>'app_role') in ('admin', 'super_admin')
    or (storage.foldername(name))[1] = (auth.jwt()->>'karyawan_id')
  )
);

-- Catatan: path file harus berformat "<karyawan_id>/<nama_file>" (folder per
-- karyawan) supaya policy di atas bisa mencocokkan pemilik file dengan benar.
