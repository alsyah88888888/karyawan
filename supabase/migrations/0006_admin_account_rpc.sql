-- ============================================================================
-- RPC untuk kelola akun admin dari UI (tab "Manajemen Admin", super_admin-only).
-- Password di-hash di server (pgcrypto/bcrypt) - client TIDAK PERNAH insert
-- password_hash langsung, supaya tidak ada kemungkinan plaintext bocor lewat
-- request/log jaringan atau salah pakai oleh developer di kemudian hari.
-- ============================================================================

create or replace function public.admin_create_account(
  p_username text,
  p_password text,
  p_nama text,
  p_role text
) returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_role text := auth.jwt()->>'app_role';
  v_caller_id bigint := (auth.jwt()->>'admin_id')::bigint;
  v_new_id bigint;
begin
  if v_caller_role <> 'super_admin' then
    raise exception 'Hanya super_admin yang boleh membuat akun admin baru';
  end if;
  if p_role not in ('admin', 'super_admin') then
    raise exception 'Role tidak valid';
  end if;

  insert into public.admin_accounts (username, password_hash, nama, role, created_by)
  values (p_username, extensions.crypt(p_password, extensions.gen_salt('bf')), p_nama, p_role, v_caller_id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.admin_create_account(text, text, text, text) to authenticated;

create or replace function public.admin_change_password(
  p_admin_id bigint,
  p_new_password text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller_role text := auth.jwt()->>'app_role';
  v_caller_id bigint := (auth.jwt()->>'admin_id')::bigint;
begin
  if v_caller_role <> 'super_admin' and v_caller_id <> p_admin_id then
    raise exception 'Tidak diizinkan mengubah password akun ini';
  end if;

  update public.admin_accounts
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
  where id = p_admin_id;
end;
$$;

grant execute on function public.admin_change_password(bigint, text) to authenticated;
