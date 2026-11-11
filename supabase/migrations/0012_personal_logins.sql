-- MVRK Pay — personal logins: a username and a password per person.
--
-- Until now reception shared one login per location and each person picked
-- their name and typed a PIN at "Who are you?". David's team signs in as
-- themselves instead: a username (rimon) and their own password. Behind the
-- username is an ordinary Supabase login on the location's domain
-- (rimon@kitepeople.com — no mailbox needed, the password is the way in), and
-- a reception login is linked to the person's name on the staff list, so the
-- session starts as that person with no name to pick and no PIN: the password
-- has already said who it is. Shared desk logins keep working as before.

alter table pay.profiles add column if not exists username text;
alter table pay.profiles add constraint profiles_username_format check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{1,31}$');
create unique index if not exists profiles_username on pay.profiles (username) where username is not null;

alter table pay.profiles add column if not exists staff_id uuid references pay.staff (id);
create unique index if not exists profiles_staff on pay.profiles (staff_id) where staff_id is not null;

-- The login email behind a username, for the sign-in page. Service role only,
-- so the public key cannot list who has a login.
create or replace function pay.email_for_username(p_username text) returns text
language sql stable security definer set search_path = pay as $$
  select email from pay.profiles where username = lower(trim(coalesce(p_username, ''))) and active
$$;
revoke all on function pay.email_for_username(text) from public, anon, authenticated;
grant execute on function pay.email_for_username(text) to service_role;

-- start_session, as in 0002, plus: a reception login linked to a staff name
-- starts as that person without a PIN.
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
  perform pay.log_action('session', sid::text, 'start', null, null, jsonb_build_object('staff_id', v_staff, 'expires_at', row.expires_at));
  return row;
end $$;
