-- Migration 0014: Fix Foreign Key Constraint pada tabel logs
-- Mengubah logs_karyawan_id_fkey menjadi ON DELETE SET NULL
-- agar jika data karyawan dihapus, PostgreSQL secara otomatis melepaskan foreign key
-- sehingga tidak memicu error 409: "violates foreign key constraint 'logs_karyawan_id_fkey'".

alter table public.logs
  drop constraint if exists logs_karyawan_id_fkey;

alter table public.logs
  add constraint logs_karyawan_id_fkey
  foreign key (karyawan_id)
  references public.karyawan(id)
  on delete set null;

-- Pastikan tabel leave_requests juga aman jika memiliki FK ke karyawan
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints 
    where constraint_name = 'leave_requests_employee_id_fkey'
  ) then
    alter table public.leave_requests drop constraint leave_requests_employee_id_fkey;
    alter table public.leave_requests add constraint leave_requests_employee_id_fkey
      foreign key (employee_id) references public.karyawan(id) on delete cascade;
  end if;
end $$;
