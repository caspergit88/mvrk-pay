-- MVRK Pay — functions, triggers and views (draft, check-in 1)

-- ---------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------
create or replace function pay.my_profile()
returns pay.profiles language sql stable security definer set search_path = pay as $$
  select * from pay.profiles where id = auth.uid() and active
$$;

create or replace function pay.my_role() returns pay.app_role
language sql stable security definer set search_path = pay as $$
  select role from pay.profiles where id = auth.uid() and active
$$;

create or replace function pay.my_location() returns uuid
language sql stable security definer set search_path = pay as $$
  select location_id from pay.profiles where id = auth.uid() and active
$$;

create or replace function pay.is_admin() returns boolean
language sql stable security definer set search_path = pay as $$
  select coalesce(pay.my_role() = 'admin', false)
$$;

create or replace function pay.is_finance() returns boolean
language sql stable security definer set search_path = pay as $$
  select coalesce(pay.my_role() in ('admin', 'finance'), false)
$$;

-- Reception at this location, or admin. Finance reads but never writes.
create or replace function pay.can_write_location(p_location uuid) returns boolean
language sql stable security definer set search_path = pay as $$
  select pay.is_admin() or (pay.my_role() = 'reception' and pay.my_location() = p_location)
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------
create or replace function pay.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['locations', 'desks', 'profiles', 'staff', 'providers', 'transactions']
  loop
    execute format('create trigger %I_touch before update on pay.%I for each row execute function pay.touch_updated_at()', t, t);
  end loop;
end $$;

-- Append-only audit of every row change. The log itself refuses update/delete
-- for everyone (service role included) — see the rules below.
create or replace function pay.audit_row() returns trigger
language plpgsql security definer set search_path = pay as $$
begin
  insert into pay.audit_log (actor, entity, entity_id, action, before, after)
  values (
    auth.uid(),
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id::text else new.id::text end), ''),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['locations', 'desks', 'profiles', 'staff', 'providers', 'transactions', 'day_closes', 'apps']
  loop
    execute format('create trigger %I_audit after insert or update or delete on pay.%I for each row execute function pay.audit_row()', t, t);
  end loop;
end $$;

create rule audit_log_no_update as on update to pay.audit_log do instead nothing;
create rule audit_log_no_delete as on delete to pay.audit_log do instead nothing;

-- Button presses that are not row writes: print, check, end of day, sign-in.
create or replace function pay.log_action(p_entity text, p_entity_id text, p_action text, p_reason text default null, p_before jsonb default null, p_after jsonb default null)
returns void language sql security definer set search_path = pay as $$
  insert into pay.audit_log (actor, entity, entity_id, action, reason, before, after)
  values (auth.uid(), p_entity, p_entity_id, p_action, p_reason, p_before, p_after)
$$;

-- Never store a secret where a trigger would copy it into the audit log.
create or replace function pay.scrub_audit_secrets() returns trigger
language plpgsql as $$
begin
  if new.entity = 'staff' then
    new.before := new.before - 'pin_hash';
    new.after := new.after - 'pin_hash';
  elsif new.entity = 'locations' then
    new.before := new.before - 'wifi_password';
    new.after := new.after - 'wifi_password';
  end if;
  return new;
end $$;
create trigger audit_log_scrub before insert on pay.audit_log for each row execute function pay.scrub_audit_secrets();

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
-- The brief allows five providers in total.
create or replace function pay.providers_max_five() returns trigger
language plpgsql as $$
begin
  if (select count(*) from pay.providers) >= 5 then
    raise exception 'MVRK Pay allows up to five payment providers. Remove one before adding another.';
  end if;
  return new;
end $$;
create trigger providers_max_five before insert on pay.providers for each row execute function pay.providers_max_five();

-- A login must be on a location's email domain, and reception's location is
-- the one its domain points at. Enforced here so no code path can create a
-- login on another domain, whatever the UI did.
create or replace function pay.profile_domain_check() returns trigger
language plpgsql as $$
declare v_domain text; v_location uuid;
begin
  v_domain := split_part(new.email, '@', 2);
  select id into v_location from pay.locations where email_domain = v_domain and active;
  if v_location is null then
    raise exception '% is not on an MVRK team domain. Logins must use kitepeople.com, mvrkhq.com, waspoclub.com or riahkiteacademy.com.', new.email;
  end if;
  if new.role = 'reception' then
    new.location_id := v_location;
  end if;
  return new;
end $$;
create trigger profiles_domain before insert or update of email, role on pay.profiles for each row execute function pay.profile_domain_check();

-- Nobody removes the last admin — there would be nobody left who can reach Settings.
create or replace function pay.keep_one_admin() returns trigger
language plpgsql as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if (select count(*) from pay.profiles where role = 'admin' and active and id <> old.id) = 0 then
      raise exception 'This is the only active admin. Make somebody else admin first, so Settings can still be reached.';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_keep_one_admin before update on pay.profiles for each row execute function pay.keep_one_admin();

-- ---------------------------------------------------------------------------
-- Business day and session expiry
-- ---------------------------------------------------------------------------
create or replace function pay.business_date_for(p_location uuid, p_at timestamptz default now()) returns date
language sql stable set search_path = pay as $$
  select (p_at at time zone l.timezone)::date from pay.locations l where l.id = p_location
$$;

-- The next logout time at the location: today's 22:00 if it is still ahead, else tomorrow's.
create or replace function pay.next_logout_at(p_location uuid, p_from timestamptz default now()) returns timestamptz
language plpgsql stable set search_path = pay as $$
declare l pay.locations; v_local timestamp; v_candidate timestamp;
begin
  select * into l from pay.locations where id = p_location;
  v_local := p_from at time zone l.timezone;
  v_candidate := v_local::date + l.logout_time;
  if v_candidate <= v_local then v_candidate := v_candidate + interval '1 day'; end if;
  return v_candidate at time zone l.timezone;
end $$;

-- Called after sign-in and after "Who are you?". Admin and finance have no
-- location; they follow Cairo's clock, which is every location's clock today.
create or replace function pay.start_session(p_staff uuid, p_pin text default null) returns pay.sessions
language plpgsql security definer set search_path = pay, extensions as $$   -- extensions: crypt() lives there
declare me pay.profiles; s pay.staff; loc uuid; row pay.sessions; sid uuid;
begin
  me := pay.my_profile();
  if me.id is null then raise exception 'Not signed in.'; end if;
  sid := (auth.jwt() ->> 'session_id')::uuid;
  if sid is null then raise exception 'No session id in the token.'; end if;

  if me.role = 'reception' then
    if p_staff is null then raise exception 'Pick your name from the list.'; end if;
    select * into s from pay.staff where id = p_staff and location_id = me.location_id and active;
    if s.id is null then raise exception 'That name is not on the list for your location.'; end if;
    if (select require_pin from pay.locations where id = me.location_id) then
      if s.pin_hash is null then raise exception 'No PIN has been set for %. Ask an admin to set one in Settings → Staff.', s.name; end if;
      if p_pin is null or s.pin_hash <> crypt(p_pin, s.pin_hash) then raise exception 'Wrong PIN.'; end if;
    end if;
    loc := me.location_id;
  else
    loc := (select id from pay.locations where active order by created_at limit 1);
  end if;

  insert into pay.sessions (session_id, profile_id, staff_id, expires_at)
  values (sid, me.id, case when me.role = 'reception' then p_staff end, pay.next_logout_at(loc))
  on conflict (session_id) do update set staff_id = excluded.staff_id, expires_at = excluded.expires_at
  returning * into row;
  perform pay.log_action('session', sid::text, 'start', null, null, jsonb_build_object('staff_id', p_staff, 'expires_at', row.expires_at));
  return row;
end $$;

-- What requireProfile() calls on every request: the live session row, or null.
create or replace function pay.current_session() returns pay.sessions
language sql stable security definer set search_path = pay as $$
  select * from pay.sessions
  where session_id = (auth.jwt() ->> 'session_id')::uuid and expires_at > now()
$$;

-- The 22:00 cron: drop what has expired (the Auth session is revoked by the job with the service role).
create or replace function pay.expire_sessions() returns integer
language sql security definer set search_path = pay as $$
  with gone as (delete from pay.sessions where expires_at <= now() returning 1)
  select count(*)::integer from gone
$$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
-- The server has already created the order at the provider; this records it and
-- puts it on the display, archiving whatever was there as "replaced".
create or replace function pay.open_order(
  p_desk uuid, p_provider uuid, p_provider_ref text, p_merchant_ref text,
  p_amount_minor integer, p_currency text, p_note text, p_booking_ref text,
  p_pay_url text, p_qr_svg text
) returns pay.transactions
language plpgsql security definer set search_path = pay as $$
declare d pay.desks; me pay.profiles; ses pay.sessions; prov pay.providers; tx pay.transactions; v_cashier text;
begin
  me := pay.my_profile();
  select * into d from pay.desks where id = p_desk and active;
  if d.id is null then raise exception 'Unknown desk.'; end if;
  if not pay.can_write_location(d.location_id) then raise exception 'You cannot take payments at this location.'; end if;
  ses := pay.current_session();
  if ses.session_id is null then raise exception 'Your session has ended. Sign in again.'; end if;
  select * into prov from pay.providers where id = p_provider and location_id = d.location_id and enabled;
  if prov.id is null then raise exception 'That payment provider is not enabled at this location.'; end if;
  if p_amount_minor > (select max_amount_minor from pay.locations where id = d.location_id) then
    raise exception 'Amount is above the limit for this location.';
  end if;
  select coalesce(s.name, me.full_name) into v_cashier from pay.staff s where s.id = ses.staff_id;
  if v_cashier is null then v_cashier := me.full_name; end if;

  -- Whatever was waiting on this desk is replaced.
  update pay.transactions t set status = 'closed', closed_reason = 'replaced'
  from pay.desk_state ds where ds.desk_id = d.id and t.id = ds.current_tx and t.status = 'waiting';

  insert into pay.transactions (location_id, desk_id, provider_id, provider_kind, provider_ref, merchant_ref,
    amount_minor, currency, note, booking_ref, staff_id, cashier_name, created_by, pay_url, qr_svg,
    expires_at, business_date)
  values (d.location_id, d.id, prov.id, prov.kind, p_provider_ref, p_merchant_ref,
    p_amount_minor, upper(p_currency), coalesce(p_note, ''), coalesce(p_booking_ref, ''), ses.staff_id, v_cashier, me.id, p_pay_url, p_qr_svg,
    now() + make_interval(mins => (select order_expiry_min from pay.locations where id = d.location_id)),
    pay.business_date_for(d.location_id))
  returning * into tx;

  insert into pay.desk_state (desk_id, current_tx, version) values (d.id, tx.id, 1)
  on conflict (desk_id) do update set current_tx = excluded.current_tx, version = pay.desk_state.version + 1, updated_at = now();
  return tx;
end $$;

-- The only way a transaction becomes paid, declined, refunded or confirmed
-- unpaid: a real answer from the provider, applied here.
create or replace function pay.apply_provider_status(
  p_tx uuid, p_state text, p_paid boolean, p_refunded boolean, p_failed_attempts integer,
  p_card_scheme text, p_card_last4 text, p_error text
) returns pay.transactions
language plpgsql security definer set search_path = pay as $$
declare tx pay.transactions; closed_day boolean;
begin
  select * into tx from pay.transactions where id = p_tx for update;
  if tx.id is null then raise exception 'Unknown transaction.'; end if;

  if p_error is not null then
    update pay.transactions set last_error = p_error where id = p_tx returning * into tx;
    return tx;
  end if;

  closed_day := exists (select 1 from pay.day_closes where location_id = tx.location_id and business_date = tx.business_date and reopened_at is null);

  update pay.transactions set
    provider_state = coalesce(p_state, provider_state),
    failed_attempts = greatest(failed_attempts, coalesce(p_failed_attempts, 0)),
    card_scheme = coalesce(p_card_scheme, card_scheme),
    card_last4 = coalesce(p_card_last4, card_last4),
    last_checked_at = now(),
    last_error = null,
    status = case when p_refunded then 'refunded'::pay.tx_status
                  when p_paid and status <> 'refunded' then 'paid'::pay.tx_status
                  else status end,
    closed_reason = case when p_paid or p_refunded then null else closed_reason end,
    paid_at = case when p_paid and paid_at is null then now() else paid_at end,
    refunded_at = case when p_refunded and refunded_at is null then now() else refunded_at end,
    late = late or (p_paid and paid_at is null and (status = 'closed' or closed_day))
  where id = p_tx returning * into tx;

  -- A paid or refunded code on the display gets a version bump so the screens repaint.
  update pay.desk_state set version = version + 1, updated_at = now() where current_tx = p_tx;
  return tx;
end $$;

-- Staff cleared the display, or the hold after Paid/Expired ran out.
create or replace function pay.clear_desk(p_desk uuid, p_reason pay.closed_reason) returns void
language plpgsql security definer set search_path = pay as $$
declare d pay.desks; cur uuid;
begin
  select * into d from pay.desks where id = p_desk;
  if d.id is null then raise exception 'Unknown desk.'; end if;
  if not pay.can_write_location(d.location_id) then raise exception 'You cannot clear this display.'; end if;
  select current_tx into cur from pay.desk_state where desk_id = p_desk;
  if cur is not null then
    update pay.transactions set status = 'closed', closed_reason = p_reason
    where id = cur and status = 'waiting';
  end if;
  update pay.desk_state set current_tx = null, version = version + 1, updated_at = now() where desk_id = p_desk;
end $$;

-- Codes past their expiry (cron, or the display's own tick).
create or replace function pay.expire_orders() returns integer
language plpgsql security definer set search_path = pay as $$
declare n integer;
begin
  with gone as (
    update pay.transactions set status = 'closed', closed_reason = 'expired'
    where status = 'waiting' and expires_at <= now() returning id
  )
  select count(*) into n from gone;
  update pay.desk_state ds set version = version + 1, updated_at = now()
  from pay.transactions t where t.id = ds.current_tx and t.closed_reason = 'expired' and t.status = 'closed';
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- The customer display: no login, just the desk's key
-- ---------------------------------------------------------------------------
-- Everything the display may know, and nothing else: no cashier, no booking
-- reference, no provider ids. The key is compared here, so the anon role can
-- call this without any table being readable to it.
create or replace function pay.display_snapshot(p_desk_slug text, p_key text) returns jsonb
language plpgsql stable security definer set search_path = pay as $$
declare d pay.desks; l pay.locations; ds pay.desk_state; tx pay.transactions;
begin
  select * into d from pay.desks where slug = p_desk_slug and active and display_key = p_key;
  if d.id is null then raise exception 'Unknown desk or wrong display key.' using errcode = '28000'; end if;
  select * into l from pay.locations where id = d.location_id;
  select * into ds from pay.desk_state where desk_id = d.id;
  if ds.current_tx is not null then select * into tx from pay.transactions where id = ds.current_tx; end if;
  return jsonb_build_object(
    'version', coalesce(ds.version, 0),
    'now', now(),
    'brand', l.brand_label,
    'idleText', l.idle_text,
    'wifi', case when coalesce(l.wifi_ssid, '') <> '' then jsonb_build_object('ssid', l.wifi_ssid, 'password', l.wifi_password, 'security', l.wifi_security) end,
    'current', case when tx.id is null then null else jsonb_build_object(
      'id', tx.id, 'status', tx.status, 'closedReason', tx.closed_reason,
      'amountMinor', tx.amount_minor, 'currency', tx.currency, 'note', tx.note,
      'qrSvg', tx.qr_svg, 'failedAttempts', tx.failed_attempts,
      'paidAt', tx.paid_at, 'expiresAt', tx.expires_at, 'updatedAt', tx.updated_at) end
  );
end $$;
revoke all on function pay.display_snapshot(text, text) from public;
grant execute on function pay.display_snapshot(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- End of day
-- ---------------------------------------------------------------------------
-- Reads as the card terminal's Z report: one line per code, totals underneath.
create or replace view pay.v_transactions as
select t.*,
  l.name as location_name, l.timezone,
  d.slug as desk_slug,
  p.name as provider_name,
  case
    when t.status = 'refunded' then 'Refunded'
    when t.status = 'paid' then 'Paid'
    when t.status = 'waiting' and t.failed_attempts > 0 then 'Declined'
    when t.status = 'waiting' then 'Waiting'
    -- Honest statuses: a code that left the display without a clean answer from
    -- the provider is "Not confirmed", whatever the reason it left — it may have
    -- been paid in its last minute. Only a checked code is called Expired, Replaced or Unpaid.
    when t.last_checked_at is null or t.last_error is not null then 'Not confirmed'
    when t.closed_reason = 'expired' then 'Expired'
    when t.closed_reason = 'replaced' then 'Replaced'
    else 'Unpaid'
  end as display_status
from pay.transactions t
join pay.locations l on l.id = t.location_id
join pay.desks d on d.id = t.desk_id
join pay.providers p on p.id = t.provider_id;

create or replace view pay.v_day_totals as
select location_id, business_date, currency,
  count(*) filter (where status = 'paid') as paid_count,
  coalesce(sum(amount_minor) filter (where status = 'paid'), 0) as paid_minor,
  count(*) filter (where status = 'refunded') as refunded_count,
  coalesce(sum(amount_minor) filter (where status = 'refunded'), 0) as refunded_minor,
  count(*) filter (where failed_attempts > 0 and status not in ('paid', 'refunded')) as declined_count,
  count(*) filter (where status = 'waiting') as open_count,
  count(*) filter (where status = 'closed' and (last_checked_at is null or last_error is not null)) as not_confirmed_count,
  count(*) filter (where late) as late_count
from pay.transactions
group by location_id, business_date, currency;

create sequence pay.day_close_seq;

create or replace function pay.close_day(p_location uuid, p_date date, p_automatic boolean default false) returns pay.day_closes
language plpgsql security definer set search_path = pay as $$
declare dc pay.day_closes; v_totals jsonb; l pay.locations;
begin
  select * into l from pay.locations where id = p_location;
  if not (pay.is_finance() or pay.can_write_location(p_location) or p_automatic) then
    raise exception 'You cannot close the day for this location.';
  end if;
  if exists (select 1 from pay.day_closes where location_id = p_location and business_date = p_date and reopened_at is null) then
    raise exception 'The % day at % is already closed. Re-open it first if something changed.', p_date, l.name;
  end if;
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_totals from pay.v_day_totals v where v.location_id = p_location and v.business_date = p_date;
  insert into pay.day_closes (location_id, business_date, close_number, closed_by, automatic, totals)
  values (p_location, p_date, upper(left(l.slug, 2)) || '-' || to_char(p_date, 'YYYY-MM-DD') || '-' || lpad(nextval('pay.day_close_seq')::text, 3, '0'),
          auth.uid(), p_automatic, jsonb_build_object('currencies', v_totals))
  on conflict (location_id, business_date) do update
    set closed_at = now(), closed_by = auth.uid(), automatic = excluded.automatic, totals = excluded.totals,
        reopened_at = null, reopened_by = null, reopen_reason = null
  returning * into dc;
  return dc;
end $$;

create or replace function pay.reopen_day(p_location uuid, p_date date, p_reason text) returns pay.day_closes
language plpgsql security definer set search_path = pay as $$
declare dc pay.day_closes;
begin
  if not pay.is_finance() then raise exception 'Only admin or finance can re-open a day.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for re-opening the day; it goes on the record.'; end if;
  update pay.day_closes set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = p_reason
  where location_id = p_location and business_date = p_date and reopened_at is null returning * into dc;
  if dc.id is null then raise exception 'That day is not closed.'; end if;
  return dc;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime: the screens subscribe to desk_state changes.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table pay.desk_state;
