-- MVRK Pay — acceptance tests (skeleton, grows with each phase)
-- Run against a scratch database:  psql "$DATABASE_URL" -f supabase/tests/acceptance.sql
-- Every test raises on failure; the whole file is one transaction and rolls back.

begin;

create or replace function pg_temp.assert(p_condition boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_condition then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end $$;

create or replace function pg_temp.assert_raises(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  % (blocked: %)', p_label, left(sqlerrm, 90);
    return;
  end;
  raise exception 'FAIL  % — the statement was allowed when it should have been blocked', p_label;
end $$;

-- ---------------------------------------------------------------------------
-- Schema basics
-- ---------------------------------------------------------------------------
select pg_temp.assert((select count(*) from pay.locations) = 4, 'four locations seeded');
select pg_temp.assert((select count(*) from pay.desks) = 4, 'one desk per location');
select pg_temp.assert((select timezone from pay.locations where slug = 'riah') = 'Africa/Cairo', 'Cairo time');

-- ---------------------------------------------------------------------------
-- Logins must be on a team domain
-- ---------------------------------------------------------------------------
do $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (u, 'someone@gmail.com');
  perform pg_temp.assert_raises(
    format($q$insert into pay.profiles (id, email, full_name, role, location_id) values ('%s', 'someone@gmail.com', 'Someone', 'reception', (select id from pay.locations limit 1))$q$, u),
    'a gmail.com login is refused');
end $$;

do $$
declare u uuid := gen_random_uuid(); p pay.profiles;
begin
  insert into auth.users (id, email) values (u, 'reception@kitepeople.com');
  insert into pay.profiles (id, email, full_name, role, location_id)
  values (u, 'reception@kitepeople.com', 'KitePeople reception', 'reception', (select id from pay.locations where slug = 'riah'))
  returning * into p;
  perform pg_temp.assert(p.location_id = (select id from pay.locations where slug = 'kitepeople'),
    'reception location follows the email domain, whatever was typed');
end $$;

-- ---------------------------------------------------------------------------
-- Providers: five at most, one default per location
-- ---------------------------------------------------------------------------
do $$
declare loc uuid := (select id from pay.locations where slug = 'riah');
begin
  -- The seed gives KitePeople one default provider; a second default there must fail on its own.
  perform pg_temp.assert_raises(
    format($q$insert into pay.providers (location_id, kind, name, currency, is_default) values ('%s', 'mock', 'Mock F', 'EUR', true)$q$, (select id from pay.locations where slug = 'kitepeople')),
    'a second default at a location is refused');
  insert into pay.providers (location_id, kind, name, currency) values
    (loc, 'mock', 'Mock A', 'EUR'), (loc, 'mock', 'Mock B', 'EUR'), (loc, 'mock', 'Mock C', 'EUR'), (loc, 'mock', 'Mock D', 'EUR');
  perform pg_temp.assert((select count(*) from pay.providers) = 5, 'five providers in total is allowed');
  perform pg_temp.assert_raises(
    format($q$insert into pay.providers (location_id, kind, name, currency) values ('%s', 'mock', 'Mock E', 'EUR')$q$, loc),
    'a sixth provider is refused');
end $$;

-- ---------------------------------------------------------------------------
-- Business day and logout time
-- ---------------------------------------------------------------------------
-- Egypt keeps summer time (UTC+3) until the last Thursday of October, so on 12 Oct Cairo is UTC+3.
select pg_temp.assert(
  pay.business_date_for((select id from pay.locations where slug = 'riah'), '2026-10-12 20:30+00'::timestamptz) = date '2026-10-12',
  '20:30 UTC on 12 Oct is still 12 Oct in Cairo (23:30 EEST)');
select pg_temp.assert(
  pay.business_date_for((select id from pay.locations where slug = 'riah'), '2026-10-12 21:30+00'::timestamptz) = date '2026-10-13',
  '21:30 UTC on 12 Oct is already 13 Oct in Cairo (00:30 EEST)');
select pg_temp.assert(
  pay.business_date_for((select id from pay.locations where slug = 'riah'), '2026-12-12 21:30+00'::timestamptz) = date '2026-12-12',
  'in December (UTC+2) 21:30 UTC is 23:30, same day');
select pg_temp.assert(
  pay.next_logout_at((select id from pay.locations where slug = 'riah'), '2026-10-12 09:00+00'::timestamptz) = '2026-10-12 22:00 Africa/Cairo'::timestamptz,
  'next logout from a morning sign-in is 22:00 the same day');
select pg_temp.assert(
  pay.next_logout_at((select id from pay.locations where slug = 'riah'), '2026-10-12 20:30+00'::timestamptz) = '2026-10-13 22:00 Africa/Cairo'::timestamptz,
  'a sign-in after 22:00 local gets tomorrow''s 22:00');

-- ---------------------------------------------------------------------------
-- Audit log cannot be rewritten
-- ---------------------------------------------------------------------------
do $$
declare n0 bigint; n1 bigint;
begin
  select count(*) into n0 from pay.audit_log;
  update pay.audit_log set action = 'tampered';
  delete from pay.audit_log;
  select count(*) into n1 from pay.audit_log;
  perform pg_temp.assert(n0 = n1 and n0 > 0 and not exists (select 1 from pay.audit_log where action = 'tampered'), 'audit log ignores update and delete');
  perform pg_temp.assert(not exists (select 1 from pay.audit_log where after ? 'pin_hash' or after ? 'wifi_password'), 'audit log never holds a PIN hash or Wi-Fi password');
end $$;

-- ---------------------------------------------------------------------------
-- 0005: staff view, PIN helper, desk → desk_state, password flag (as admin)
-- ---------------------------------------------------------------------------
do $$
declare
  admin_id uuid := gen_random_uuid();
  loc uuid := (select id from pay.locations where slug = 'waspo');
  s uuid; d uuid; k1 text; k2 text;
begin
  insert into auth.users (id, email) values (admin_id, 'david@mvrkhq.com');
  insert into pay.profiles (id, email, full_name, role) values (admin_id, 'david@mvrkhq.com', 'David', 'admin');
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'session_id', gen_random_uuid())::text, true);

  -- 0009: a login alone is not an admin; the session (after the code step) is.
  perform pg_temp.assert(not pay.is_admin() and not pay.is_finance(), 'an admin login without a live session has no admin or finance powers');
  perform pg_temp.assert_raises($q$select pay.set_staff_pin(gen_random_uuid(), '1234')$q$, 'admin functions refuse a login with no session');
  perform pay.start_session(null, null);
  perform pg_temp.assert(pay.is_admin() and pay.is_finance(), 'once the session starts, the admin is an admin');

  insert into pay.staff (location_id, name) values (loc, 'Omar') returning id into s;
  perform pg_temp.assert((select has_pin from pay.staff_names where id = s) = false, 'staff_names shows no PIN yet and never the hash');
  perform pg_temp.assert_raises(format($q$select pay.set_staff_pin('%s', '12')$q$, s), 'a PIN must be four digits');
  perform pay.set_staff_pin(s, '4321');
  perform pg_temp.assert((select has_pin from pay.staff_names where id = s), 'set_staff_pin stores a PIN');
  perform pg_temp.assert((select pin_hash from pay.staff where id = s) <> '4321', 'the PIN is hashed, not stored');
  perform pay.set_staff_pin(s, '');
  perform pg_temp.assert((select has_pin from pay.staff_names where id = s) = false, 'an empty PIN clears it');

  insert into pay.desks (location_id, slug, name) values (loc, 'desk-2', 'Desk 2') returning id into d;
  perform pg_temp.assert(exists (select 1 from pay.desk_state where desk_id = d), 'a new desk gets its display row automatically');
  select display_key into k1 from pay.desks where id = d;
  k2 := pay.rotate_display_key(d);
  perform pg_temp.assert(k2 <> k1 and length(k2) = 36 and (select display_key from pay.desks where id = d) = k2, 'rotate_display_key issues a fresh 36-char key');

  perform pay.password_changed();
  perform pg_temp.assert((select must_change_password from pay.profiles where id = admin_id) = false, 'password_changed clears the flag for the caller');

  perform pg_temp.assert_raises(format($q$update pay.profiles set role = 'finance' where id = '%s'$q$, admin_id), 'the only admin cannot be demoted');

  -- After 22:00 the session has expired: the login alone no longer carries admin powers.
  update pay.sessions set expires_at = now() - interval '1 second' where profile_id = admin_id;
  perform pg_temp.assert(not pay.is_admin(), 'an expired session takes the admin powers with it');
  update pay.sessions set expires_at = now() + interval '1 hour' where profile_id = admin_id;
end $$;

-- ---------------------------------------------------------------------------
-- Payments, as the reception user at KitePeople (JWT claims are simulated)
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid := (select id from pay.profiles where email = 'reception@kitepeople.com');
  sid uuid := gen_random_uuid();
  loc uuid := (select id from pay.locations where slug = 'kitepeople');
  d uuid := (select id from pay.desks where location_id = (select id from pay.locations where slug = 'kitepeople'));
  prov uuid := (select id from pay.providers where location_id = (select id from pay.locations where slug = 'kitepeople') and is_default);
  anna uuid; ses pay.sessions; t1 pay.transactions; t2 pay.transactions; snap jsonb; dc pay.day_closes;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'session_id', sid)::text, true);

  insert into pay.staff (location_id, name, pin_hash) values (loc, 'Anna', crypt('1234', gen_salt('bf'))) returning id into anna;
  perform pg_temp.assert_raises(format($q$select pay.start_session('%s', '0000')$q$, anna), 'wrong PIN is refused');
  ses := pay.start_session(anna, '1234');
  perform pg_temp.assert(ses.staff_id = anna and ses.expires_at > now(), 'session starts with the cashier and a 22:00 expiry');

  t1 := pay.open_order(d, prov, 'order-1', 'QR-KP-TEST-0001', 1250, 'eur', 'Kite lesson', 'KH-77', 'https://pay.example/1', '<svg/>');
  perform pg_temp.assert(t1.status = 'waiting' and t1.cashier_name = 'Anna' and t1.currency = 'EUR' and t1.business_date = pay.business_date_for(loc), 'order opens as waiting with the cashier stamped');
  perform pg_temp.assert((select current_tx from pay.desk_state where desk_id = d) = t1.id, 'the desk shows the new order');

  t2 := pay.open_order(d, prov, 'order-2', 'QR-KP-TEST-0002', 500, 'EUR', '', '', 'https://pay.example/2', '<svg/>');
  perform pg_temp.assert((select status from pay.transactions where id = t1.id) = 'closed' and (select closed_reason from pay.transactions where id = t1.id) = 'replaced', 'a second order replaces the first');
  perform pg_temp.assert((select display_status from pay.v_transactions where id = t1.id) = 'Not confirmed', 'a replaced code that was never checked reads Not confirmed');

  perform pay.apply_provider_status(t2.id, 'FAILED', false, false, 1, null, null, null);
  perform pg_temp.assert((select display_status from pay.v_transactions where id = t2.id) = 'Declined', 'a failed attempt reads Declined while the code stays live');
  perform pay.apply_provider_status(t2.id, 'PURCHASED', true, false, 1, 'VISA', '4242', null);
  perform pg_temp.assert((select status from pay.transactions where id = t2.id) = 'paid' and (select card_last4 from pay.transactions where id = t2.id) = '4242', 'a PURCHASED answer makes it paid with the last four');

  snap := pay.display_snapshot('desk-1', (select display_key from pay.desks where id = d));
  perform pg_temp.assert(snap -> 'current' ->> 'status' = 'paid' and not (snap -> 'current' ? 'cashier_name') and not (snap::text like '%KH-77%'), 'the display sees paid and nothing about who or which booking');
  perform pg_temp.assert_raises($q$select pay.display_snapshot('desk-1', 'wrong-key')$q$, 'the display needs the right key');

  perform pay.clear_desk(d, 'done');
  perform pg_temp.assert((select current_tx from pay.desk_state where desk_id = d) is null, 'clear empties the display');
  perform pg_temp.assert((select status from pay.transactions where id = t2.id) = 'paid', 'clearing never touches a paid record');

  dc := pay.close_day(loc, pay.business_date_for(loc), false);
  perform pg_temp.assert((dc.totals -> 'currencies' -> 0 ->> 'paid_minor')::int = 500 and (dc.totals -> 'currencies' -> 0 ->> 'not_confirmed_count')::int = 1, 'end of day totals: one paid (5.00), one not confirmed');
  perform pg_temp.assert_raises(format($q$select pay.close_day('%s', '%s', false)$q$, loc, pay.business_date_for(loc)), 'a closed day cannot be closed twice');
  perform pg_temp.assert_raises(format($q$select pay.reopen_day('%s', '%s', 'because')$q$, loc, pay.business_date_for(loc)), 'reception cannot re-open a day');
  perform pay.apply_provider_status(t1.id, 'PURCHASED', true, false, 0, 'MC', '1111', null);
  perform pg_temp.assert((select late from pay.transactions where id = t1.id), 'a payment landing after the close is flagged late');

  -- 0006: the staff screen's snapshot, the display addressed by location + desk, views under RLS
  snap := pay.desk_snapshot(d);
  perform pg_temp.assert(jsonb_array_length(snap -> 'recent') = 2 and (snap -> 'current') is not null, 'desk_snapshot carries today''s recent list');
  perform pg_temp.assert_raises(format($q$select pay.desk_snapshot('%s')$q$, (select id from pay.desks where location_id = (select id from pay.locations where slug = 'riah') limit 1)), 'desk_snapshot refuses another location''s desk');
  snap := pay.display_snapshot('kitepeople', 'desk-1', (select display_key from pay.desks where id = d));
  perform pg_temp.assert(snap ->> 'deskId' = d::text, 'display_snapshot by location and desk slug');
  perform pg_temp.assert_raises($q$select pay.display_snapshot('riah', 'desk-1', 'nope')$q$, 'display_snapshot with the wrong key is refused');
  perform pg_temp.assert(pay.read_secret('NGENIUS_API_KEY') is null, 'read_secret is null where there is no Vault (local)');
end $$;

-- Views obey RLS: reception at KitePeople cannot see Riah's transactions through v_transactions.
do $$
declare
  u uuid := (select id from pay.profiles where email = 'reception@kitepeople.com');
  n int;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'session_id', gen_random_uuid())::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from pay.v_transactions where location_id <> pay.my_location();
  perform pg_temp.assert(n = 0, 'v_transactions shows reception only their own location');
  select count(*) into n from pay.v_transactions;
  perform pg_temp.assert(n = 2, 'and does show their own');
  perform set_config('role', 'postgres', true);
end $$;

-- 0007: the report function, the unresolved list, which locations are due for the nightly close
do $$
declare
  kp uuid := (select id from pay.locations where slug = 'kitepeople');
  riah uuid := (select id from pay.locations where slug = 'riah');
  today date := pay.business_date_for((select id from pay.locations where slug = 'kitepeople'));
  u uuid := (select id from pay.profiles where email = 'reception@kitepeople.com');
  r jsonb; n int; dc_id uuid;
begin
  -- as reception at KitePeople
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'session_id', gen_random_uuid())::text, true);
  r := pay.report_data(kp, today);
  perform pg_temp.assert(jsonb_array_length(r -> 'lines') = 2, 'report_data lists the day''s two codes');
  perform pg_temp.assert((r -> 'totals' -> 0 ->> 'paid_count')::int = 2 and (r -> 'totals' -> 0 ->> 'paid_minor')::int = 1750, 'report_data totals: both codes paid, 17.50');
  perform pg_temp.assert((r -> 'close' ->> 'close_number') is not null and (r -> 'close' ->> 'closed_by_name') is not null, 'report_data carries the close and who closed it');
  perform pg_temp.assert(jsonb_array_length(r -> 'byCashier') = 1 and (r -> 'byCashier' -> 0 ->> 'cashier_name') = 'Anna', 'report_data groups by person');
  perform pg_temp.assert(r -> 'desks' = '["desk-1"]'::jsonb, 'report_data names the desks');
  perform pg_temp.assert_raises(format($q$select pay.report_data('%s', '%s')$q$, riah, today), 'reception cannot pull another location''s report');
  select count(*) into n from pay.unresolved_for_day(kp, today);
  perform pg_temp.assert(n = 0, 'nothing is unresolved once both codes are paid');
  perform set_config('role', 'authenticated', true);
  perform pg_temp.assert((select paid_minor from pay.range_totals(null, today - 7, today)) = 1750, 'range_totals sums the week for the locations this person can see');
  perform pay.note_audit('transactions', 'export_csv', '{"rows": 2}'::jsonb);
  perform set_config('role', 'postgres', true);
  perform pg_temp.assert(exists (select 1 from pay.audit_log where action = 'export_csv' and actor = u), 'note_audit records who exported');
  select count(*) into n from pay.unresolved_for_day(riah, today);
  perform pg_temp.assert(n = 0, 'unresolved_for_day shows reception nothing for another location');

  -- as the service role (the nightly job)
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.assert(pay.is_service(), 'is_service reads the role claim');
  r := pay.report_data(riah, today);
  perform pg_temp.assert(jsonb_array_length(r -> 'lines') = 0 and jsonb_typeof(r -> 'close') = 'null', 'the service role can read any location''s report (Riah: empty, not closed)');
  update pay.locations set logout_time = '00:00' where id = riah;
  perform pg_temp.assert(exists (select 1 from pay.locations_due_for_close() where location_id = riah), 'a location past its logout time with no close is due');
  perform pg_temp.assert(not exists (select 1 from pay.locations_due_for_close() where location_id = kp), 'a location already closed today is not due');
  select id into dc_id from pay.day_closes where location_id = kp and business_date = today;
  perform pay.set_report_path(dc_id, 'kitepeople/test.pdf');
  perform pg_temp.assert((select report_path from pay.day_closes where id = dc_id) = 'kitepeople/test.pdf', 'set_report_path records the PDF');
  perform pg_temp.assert(exists (select 1 from storage.buckets where id = 'pay-reports' and not public), 'the pay-reports bucket exists and is private');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- 0008: login rate limits and the admin email code (service role only)
-- ---------------------------------------------------------------------------
do $$
declare
  i int; msg text; code text; code2 text;
  boss uuid := gen_random_uuid();
  desk_person uuid := (select id from pay.profiles where role = 'reception' limit 1);
  sid uuid := gen_random_uuid();
begin
  perform pg_temp.assert(pay.login_allowed('anna@kitepeople.com', '10.0.0.1') is null, 'a first sign-in is allowed');
  for i in 1..4 loop perform pay.login_note('anna@kitepeople.com', '10.0.0.1', false); end loop;
  perform pg_temp.assert(pay.login_allowed('Anna@KitePeople.com ', '10.0.0.2') is null, 'four wrong passwords are still allowed (email compared in lower case)');
  perform pay.login_note('anna@kitepeople.com', '10.0.0.1', false);
  msg := pay.login_allowed('anna@kitepeople.com', '10.0.0.2');
  perform pg_temp.assert(msg like 'Too many wrong passwords for this email%', 'the fifth wrong password blocks that email, from any address');
  perform pg_temp.assert(pay.login_allowed('ben@kitepeople.com', '10.0.0.1') is null, 'another email on the same network is not blocked by one person''s mistakes');

  insert into pay.login_attempts (at, email, ip, ok)
  select now() - interval '20 minutes', 'old@kitepeople.com', '10.0.0.9', false from generate_series(1, 9);
  perform pg_temp.assert(pay.login_allowed('old@kitepeople.com', '10.0.0.9') is null, 'failures older than 15 minutes no longer count');

  for i in 1..20 loop perform pay.login_note('user' || i || '@kitepeople.com', '10.6.6.6', false); end loop;
  perform pg_temp.assert(pay.login_allowed('fresh@kitepeople.com', '10.6.6.6') like 'Too many failed sign-ins from this network%', 'twenty failures from one address block that address');
  perform pg_temp.assert(pay.login_allowed('fresh@kitepeople.com', '10.0.0.3') is null, 'and only that address');

  -- The admin code
  insert into auth.users (id, email) values (boss, 'ops@mvrkhq.com');
  insert into pay.profiles (id, email, full_name, role) values (boss, 'ops@mvrkhq.com', 'Ops', 'admin');
  perform pg_temp.assert_raises(format($q$select pay.issue_admin_code('%s', '%s')$q$, desk_person, gen_random_uuid()), 'reception never gets an admin code');
  code := pay.issue_admin_code(boss, sid);
  perform pg_temp.assert(code ~ '^[0-9]{6}$', 'the admin code is six digits');
  perform pg_temp.assert((select code_hash from pay.admin_codes where session_id = sid) <> code, 'only a hash of the code is kept');
  perform pg_temp.assert(not exists (select 1 from pay.audit_log where after::text like '%' || code || '%' and action like 'admin_code%'), 'the audit log never holds the code');
  msg := pay.verify_admin_code(boss, sid, case when code = '000000' then '111111' else '000000' end);
  perform pg_temp.assert(msg like 'That code is not right%', 'a wrong code is refused');
  perform pg_temp.assert(pay.verify_admin_code(gen_random_uuid(), sid, code) like 'No code has been sent%', 'a code belongs to its admin');
  perform pg_temp.assert(pay.verify_admin_code(boss, sid, ' ' || code || ' ') is null, 'the right code lets the admin in');
  perform pg_temp.assert(pay.verify_admin_code(boss, sid, code) like 'That code has already been used%', 'a code works once');

  code2 := pay.issue_admin_code(boss, sid);
  for i in 1..5 loop perform pay.verify_admin_code(boss, sid, case when code2 = '000000' then '111111' else '000000' end); end loop;
  perform pg_temp.assert(pay.verify_admin_code(boss, sid, code2) like 'Too many wrong codes%', 'five wrong codes lock that code, even the right one after');
  update pay.admin_codes set expires_at = now() - interval '1 second', attempts = 0 where session_id = sid;
  perform pg_temp.assert(pay.verify_admin_code(boss, sid, code2) like 'That code has expired%', 'an expired code is refused');
  for i in 1..3 loop perform pay.issue_admin_code(boss, sid); end loop;
  perform pg_temp.assert_raises(format($q$select pay.issue_admin_code('%s', '%s')$q$, boss, sid), 'no more than five codes per sign-in');

  -- None of it is reachable with a user's or the public key.
  perform set_config('role', 'authenticated', true);
  perform pg_temp.assert_raises($q$select pay.login_note('x@kitepeople.com', '1.1.1.1', false)$q$, 'a signed-in user cannot record attempts (no locking others out)');
  perform pg_temp.assert_raises(format($q$select pay.issue_admin_code('%s', '%s')$q$, boss, gen_random_uuid()), 'a signed-in user cannot issue themselves a code');
  perform pg_temp.assert_raises('select count(*) from pay.admin_codes', 'a signed-in user cannot read the code table');
  perform set_config('role', 'anon', true);
  perform pg_temp.assert_raises($q$select pay.login_allowed('x@kitepeople.com', '1.1.1.1')$q$, 'the public key cannot probe the limits');
  perform set_config('role', 'postgres', true);
end $$;

rollback;
