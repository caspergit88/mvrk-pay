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
end $$;

rollback;
