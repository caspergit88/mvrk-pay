-- MVRK Pay — each person on reception gets a desk of their own at sign-in.
--
-- The first person in at a location gets Desk 1, the next Desk 2, and so on.
-- Signing out (or "Switch person") frees the desk; the same person signing in
-- again — say after closing the browser — gets their own desk back rather
-- than a second one. Nobody picks a desk: when every desk is taken the screen
-- says who is where, and an admin frees a desk (someone who left without
-- signing out). A reception session takes payments on its own desk only.
-- Admin, Manager (finance) and the nightly job have no desk.

alter table pay.sessions add column if not exists desk_id uuid references pay.desks (id);
-- One live session per desk (expired sessions give their desk up in start_session).
create unique index if not exists sessions_one_per_desk on pay.sessions (desk_id) where desk_id is not null;

-- Which desk a reception session should have; sets it and returns it (null = all taken).
-- Internal: called by start_session, which has already checked who is asking.
create or replace function pay.assign_desk(p_session uuid) returns uuid
language plpgsql security definer set search_path = pay as $$
declare ses pay.sessions; me pay.profiles; v_desk uuid;
begin
  select * into ses from pay.sessions where session_id = p_session;
  select * into me from pay.profiles where id = ses.profile_id;
  if me.role <> 'reception' then return null; end if;
  -- One person choosing at a time per location, so two sign-ins never land on the same desk.
  perform pg_advisory_xact_lock(hashtext('pay.desk:' || me.location_id::text));
  update pay.sessions set desk_id = null where desk_id is not null and expires_at <= now();

  -- Already on a desk in this session (a repeat start), still active: keep it.
  select d.id into v_desk from pay.desks d where d.id = ses.desk_id and d.active;
  -- The same person on a desk in another live session (a closed browser): take that desk back.
  if v_desk is null and ses.staff_id is not null then
    select s.desk_id into v_desk from pay.sessions s join pay.desks d on d.id = s.desk_id and d.active
    where s.staff_id = ses.staff_id and s.session_id <> p_session and s.expires_at > now()
    order by s.created_at desc limit 1;
  end if;
  -- Otherwise the first free desk, in the order the desks were made (Desk 1, Desk 2, …).
  if v_desk is null then
    select d.id into v_desk from pay.desks d
    where d.location_id = me.location_id and d.active
      and not exists (select 1 from pay.sessions s where s.desk_id = d.id and s.session_id <> p_session)
    order by d.created_at, d.slug limit 1;
  end if;

  if v_desk is not null then
    update pay.sessions set desk_id = null where desk_id = v_desk and session_id <> p_session;
    update pay.sessions set desk_id = v_desk where session_id = p_session;
  end if;
  return v_desk;
end $$;
revoke all on function pay.assign_desk(uuid) from public, anon, authenticated;

-- start_session, as in 0012, then a desk for reception.
create or replace function pay.start_session(p_staff uuid, p_pin text default null) returns pay.sessions
language plpgsql security definer set search_path = pay, extensions as $$   -- extensions: crypt() lives there
declare me pay.profiles; s pay.staff; loc uuid; row pay.sessions; sid uuid; v_staff uuid := p_staff;
begin
  me := pay.my_profile();
  if me.id is null then raise exception 'Not signed in.'; end if;
  sid := (auth.jwt() ->> 'session_id')::uuid;
  if sid is null then raise exception 'No session id in the token.'; end if;

  if me.role = 'reception' then
    if me.staff_id is not null and (v_staff is null or v_staff = me.staff_id) then
      -- A personal login: the password already said who this is.
      select * into s from pay.staff where id = me.staff_id and location_id = me.location_id and active;
      if s.id is null then raise exception 'Your name is no longer on the staff list here. Ask David.'; end if;
      v_staff := me.staff_id;
    else
      if v_staff is null then raise exception 'Pick your name from the list.'; end if;
      select * into s from pay.staff where id = v_staff and location_id = me.location_id and active;
      if s.id is null then raise exception 'That name is not on the list for your location.'; end if;
      if (select require_pin from pay.locations where id = me.location_id) then
        if s.pin_hash is null then raise exception 'No PIN has been set for %. Ask an admin to set one in Settings → Staff.', s.name; end if;
        if p_pin is null or s.pin_hash <> crypt(p_pin, s.pin_hash) then raise exception 'Wrong PIN.'; end if;
      end if;
    end if;
    loc := me.location_id;
  else
    loc := (select id from pay.locations where active order by created_at limit 1);
  end if;

  insert into pay.sessions (session_id, profile_id, staff_id, expires_at)
  values (sid, me.id, case when me.role = 'reception' then v_staff end, pay.next_logout_at(loc))
  on conflict (session_id) do update set staff_id = excluded.staff_id, expires_at = excluded.expires_at
  returning * into row;

  if me.role = 'reception' then
    perform pay.assign_desk(sid);
    select * into row from pay.sessions where session_id = sid;
  end if;
  perform pay.log_action('session', sid::text, 'start', null, null,
    jsonb_build_object('staff_id', v_staff, 'desk_id', row.desk_id, 'expires_at', row.expires_at));
  return row;
end $$;

-- Who is on which desk at a location, for the "all desks are taken" screen.
create or replace function pay.desk_occupancy(p_location uuid)
returns table (desk_id uuid, desk_name text, desk_slug text, staff_name text, since timestamptz)
language sql stable security definer set search_path = pay as $$
  select d.id, d.name, d.slug, st.name, s.created_at
  from pay.desks d
  left join pay.sessions s on s.desk_id = d.id and s.expires_at > now()
  left join pay.staff st on st.id = s.staff_id
  where d.location_id = p_location and d.active
    and (pay.is_finance() or pay.my_location() = p_location)
  order by d.created_at, d.slug
$$;
grant execute on function pay.desk_occupancy(uuid) to authenticated;

-- A reception session without a desk (it was freed, or every desk was taken
-- at sign-in) asks again when its payment screen opens.
create or replace function pay.claim_my_desk() returns uuid
language plpgsql security definer set search_path = pay as $$
declare ses pay.sessions;
begin
  ses := pay.current_session();
  if ses.session_id is null or pay.my_role() is distinct from 'reception' then return null; end if;
  return pay.assign_desk(ses.session_id);
end $$;
grant execute on function pay.claim_my_desk() to authenticated;

-- Admin: free a desk held by someone who left without signing out. They keep
-- their sign-in; their payment screen looks for a desk again.
create or replace function pay.release_desk(p_desk uuid) returns void
language plpgsql security definer set search_path = pay as $$
declare prev text;
begin
  if not pay.is_admin() then raise exception 'Only an admin can free a desk.'; end if;
  select st.name into prev from pay.sessions s left join pay.staff st on st.id = s.staff_id where s.desk_id = p_desk;
  update pay.sessions set desk_id = null where desk_id = p_desk;
  perform pay.log_action('desks', p_desk::text, 'release', null, jsonb_build_object('staff_name', prev), null);
end $$;
grant execute on function pay.release_desk(uuid) to authenticated;

-- open_order, as in 0002, plus: reception takes payments on its own desk only.
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
  if me.role = 'reception' and ses.desk_id is distinct from d.id then
    raise exception 'This is not your desk any more — it was freed by an admin. Reload the page to be given a desk.';
  end if;
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
