-- MVRK Pay — the "Who are you?" step and the admin helpers behind Settings.

-- ---------------------------------------------------------------------------
-- Staff names without the PIN hash. security_invoker so the staff table's RLS
-- still decides who sees which location's list.
-- ---------------------------------------------------------------------------
create or replace view pay.staff_names
with (security_invoker = true) as
select id, location_id, name, active, sort_order, (pin_hash is not null) as has_pin, created_at, updated_at
from pay.staff;

grant select on pay.staff_names to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Set or clear a PIN. Admin only; the hash never leaves the database.
-- ---------------------------------------------------------------------------
create or replace function pay.set_staff_pin(p_staff uuid, p_pin text) returns void
language plpgsql security definer set search_path = pay, extensions as $$
begin
  if not pay.is_admin() then raise exception 'Only an admin can set a PIN.'; end if;
  if p_pin is null or p_pin = '' then
    update pay.staff set pin_hash = null where id = p_staff;
  else
    if p_pin !~ '^[0-9]{4}$' then raise exception 'A PIN is exactly four digits.'; end if;
    update pay.staff set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_staff;
  end if;
  if not found then raise exception 'Unknown staff name.'; end if;
  perform pay.log_action('staff', p_staff::text, case when p_pin is null or p_pin = '' then 'pin_cleared' else 'pin_set' end);
end $$;

-- ---------------------------------------------------------------------------
-- A new display key for a desk. The old link stops working at once, so the
-- iPad has to be re-opened with the new one — Settings says so.
-- ---------------------------------------------------------------------------
create or replace function pay.rotate_display_key(p_desk uuid) returns text
language plpgsql security definer set search_path = pay, extensions as $$
declare k text;
begin
  if not pay.is_admin() then raise exception 'Only an admin can regenerate a display link.'; end if;
  k := encode(gen_random_bytes(18), 'hex');
  update pay.desks set display_key = k where id = p_desk;
  if not found then raise exception 'Unknown desk.'; end if;
  return k;
end $$;

-- ---------------------------------------------------------------------------
-- A new desk gets its display row at once, whoever created it.
-- ---------------------------------------------------------------------------
create or replace function pay.desk_state_for_new_desk() returns trigger
language plpgsql security definer set search_path = pay as $$
begin
  insert into pay.desk_state (desk_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger desks_create_state after insert on pay.desks for each row execute function pay.desk_state_for_new_desk();

-- Admin may fix desk_state by hand (a stuck display); nobody else writes it directly.
create policy desk_state_admin on pay.desk_state for all using (pay.is_admin()) with check (pay.is_admin());

-- ---------------------------------------------------------------------------
-- The starter password an admin set is spent once the person replaces it.
-- ---------------------------------------------------------------------------
create or replace function pay.password_changed() returns void
language sql security definer set search_path = pay as $$
  update pay.profiles set must_change_password = false where id = auth.uid()
$$;

-- "Switch person": drop my own session row so the next request asks again.
create or replace function pay.end_session() returns void
language sql security definer set search_path = pay as $$
  delete from pay.sessions where session_id = (auth.jwt() ->> 'session_id')::uuid
$$;

grant execute on function pay.set_staff_pin(uuid, text), pay.rotate_display_key(uuid), pay.password_changed(), pay.end_session() to authenticated, service_role;
