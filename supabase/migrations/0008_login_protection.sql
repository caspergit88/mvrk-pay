-- MVRK Pay — login protection (BRIEF.md: "rate-limit the login route (per IP
-- and per email) and require an email one-time code for admin sign-in").
--
-- Both tables are written and read only through the functions below, and the
-- functions are granted to the service role alone: if the anon key could record
-- a failed attempt, anyone could lock anyone else out; if a signed-in admin
-- could issue their own code, the code would prove nothing.

-- ---------------------------------------------------------------------------
-- Sign-in attempts
-- ---------------------------------------------------------------------------
create table pay.login_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  email text not null,
  ip text not null default '',
  ok boolean not null
);
create index login_attempts_email on pay.login_attempts (email, at desc);
create index login_attempts_ip on pay.login_attempts (ip, at desc);
alter table pay.login_attempts enable row level security;
alter table pay.login_attempts force row level security;

-- Null when a sign-in may go ahead; otherwise the message to show. Counts
-- failures in the last 15 minutes: five per email (since its last success),
-- twenty per address.
create or replace function pay.login_allowed(p_email text, p_ip text) returns text
language plpgsql stable security definer set search_path = pay as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_since timestamptz := now() - interval '15 minutes';
  v_last_ok timestamptz;
  v_wait int;
begin
  select max(at) into v_last_ok from pay.login_attempts where email = v_email and ok;
  if (select count(*) from pay.login_attempts
      where email = v_email and not ok and at > greatest(v_since, coalesce(v_last_ok, v_since))) >= 5 then
    select ceil(extract(epoch from (min(at) + interval '15 minutes' - now())) / 60) into v_wait
    from (select at from pay.login_attempts
          where email = v_email and not ok and at > greatest(v_since, coalesce(v_last_ok, v_since))
          order by at desc limit 5) recent;
    return format('Too many wrong passwords for this email. Try again in %s minute%s, or ask David to reset it.',
                  greatest(v_wait, 1), case when greatest(v_wait, 1) = 1 then '' else 's' end);
  end if;
  if coalesce(p_ip, '') <> '' and (select count(*) from pay.login_attempts where ip = p_ip and not ok and at > v_since) >= 20 then
    return 'Too many failed sign-ins from this network. Try again in 15 minutes.';
  end if;
  return null;
end $$;

-- Record an attempt. Rows older than a day are tidied away as it goes.
create or replace function pay.login_note(p_email text, p_ip text, p_ok boolean) returns void
language sql security definer set search_path = pay as $$
  delete from pay.login_attempts where at < now() - interval '1 day';
  insert into pay.login_attempts (email, ip, ok) values (lower(trim(coalesce(p_email, ''))), coalesce(p_ip, ''), p_ok);
$$;

-- ---------------------------------------------------------------------------
-- Admin one-time codes, one per Supabase session
-- ---------------------------------------------------------------------------
create table pay.admin_codes (
  session_id uuid primary key,
  profile_id uuid not null references pay.profiles (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  issued int not null default 1,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table pay.admin_codes enable row level security;
alter table pay.admin_codes force row level security;

-- A fresh six-digit code for this session, valid ten minutes. Returns the code
-- so the server can email it; only the hash is kept. Five codes per session.
create or replace function pay.issue_admin_code(p_profile uuid, p_session uuid) returns text
language plpgsql security definer set search_path = pay, extensions as $$
declare
  v_code text;
  v_bytes bytea;
  v_issued int;
begin
  if not exists (select 1 from pay.profiles where id = p_profile and role = 'admin' and active) then
    raise exception 'Only an active admin gets a sign-in code.';
  end if;
  select issued into v_issued from pay.admin_codes where session_id = p_session;
  if v_issued >= 5 then
    raise exception 'Five codes have been sent for this sign-in. Sign in again from the start.';
  end if;
  v_bytes := gen_random_bytes(4);
  v_code := lpad(((get_byte(v_bytes, 0)::bigint << 24 | get_byte(v_bytes, 1) << 16 | get_byte(v_bytes, 2) << 8 | get_byte(v_bytes, 3)) % 1000000)::text, 6, '0');
  insert into pay.admin_codes (session_id, profile_id, code_hash, expires_at)
  values (p_session, p_profile, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes')
  on conflict (session_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
        issued = pay.admin_codes.issued + 1, verified_at = null;
  perform pay.log_action('session', p_session::text, 'admin_code_sent', null, null, jsonb_build_object('profile_id', p_profile));
  return v_code;
end $$;

-- Null when the code is right (and marks it used); otherwise what to tell the person.
create or replace function pay.verify_admin_code(p_profile uuid, p_session uuid, p_code text) returns text
language plpgsql security definer set search_path = pay, extensions as $$
declare c pay.admin_codes;
begin
  select * into c from pay.admin_codes where session_id = p_session and profile_id = p_profile for update;
  if c.session_id is null then return 'No code has been sent for this sign-in. Press “Send a new code”.'; end if;
  if c.verified_at is not null then return 'That code has already been used. Sign in again from the start.'; end if;
  if c.expires_at <= now() then return 'That code has expired. Press “Send a new code”.'; end if;
  if c.attempts >= 5 then return 'Too many wrong codes. Press “Send a new code”.'; end if;
  if c.code_hash <> crypt(trim(coalesce(p_code, '')), c.code_hash) then
    update pay.admin_codes set attempts = attempts + 1 where session_id = p_session;
    perform pay.log_action('session', p_session::text, 'admin_code_wrong', null, null, jsonb_build_object('profile_id', p_profile));
    return 'That code is not right. Check the latest email and try again.';
  end if;
  update pay.admin_codes set verified_at = now() where session_id = p_session;
  perform pay.log_action('session', p_session::text, 'admin_code_ok', null, null, jsonb_build_object('profile_id', p_profile));
  return null;
end $$;

revoke all on function pay.login_allowed(text, text) from public, anon, authenticated;
revoke all on function pay.login_note(text, text, boolean) from public, anon, authenticated;
revoke all on function pay.issue_admin_code(uuid, uuid) from public, anon, authenticated;
revoke all on function pay.verify_admin_code(uuid, uuid, text) from public, anon, authenticated;
grant execute on function pay.login_allowed(text, text) to service_role;
grant execute on function pay.login_note(text, text, boolean) to service_role;
grant execute on function pay.issue_admin_code(uuid, uuid) to service_role;
grant execute on function pay.verify_admin_code(uuid, uuid, text) to service_role;

-- 0003's default privileges gave authenticated table rights; RLS with no
-- policy already refuses them, and this says so outright.
revoke all on pay.login_attempts, pay.admin_codes from anon, authenticated;
