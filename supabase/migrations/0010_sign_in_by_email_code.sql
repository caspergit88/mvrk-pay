-- MVRK Pay — sign in with a code sent to your email, instead of a password.
--
-- One row per email: the hash of the latest code, when it expires, how many
-- wrong tries, and how many codes went out this hour. Like 0008, everything
-- goes through functions granted to the service role alone, so nobody can ask
-- for a code on someone else's behalf except through the sign-in page (which
-- the per-email and per-network limits of 0008 also cover).

create table pay.login_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_count int not null default 1,
  window_started timestamptz not null default now(),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table pay.login_codes enable row level security;
alter table pay.login_codes force row level security;

-- A fresh six-digit code for an active MVRK Pay login, valid ten minutes.
-- Returns null (and sends nothing) for an email with no active login, so the
-- page can say the same thing either way. Five codes per email per hour.
create or replace function pay.issue_login_code(p_email text) returns text
language plpgsql security definer set search_path = pay, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row pay.login_codes;
  v_bytes bytea;
  v_code text;
begin
  if not exists (select 1 from pay.profiles where email = v_email and active) then
    return null;
  end if;
  select * into v_row from pay.login_codes where email = v_email;
  if v_row.email is not null and v_row.window_started > now() - interval '1 hour' and v_row.sent_count >= 5 then
    raise exception 'Five codes have gone to this email in the last hour. Wait a little, or ask David for a temporary password.';
  end if;
  v_bytes := gen_random_bytes(4);
  v_code := lpad(((get_byte(v_bytes, 0)::bigint << 24 | get_byte(v_bytes, 1) << 16 | get_byte(v_bytes, 2) << 8 | get_byte(v_bytes, 3)) % 1000000)::text, 6, '0');
  insert into pay.login_codes (email, code_hash, expires_at)
  values (v_email, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes')
  on conflict (email) do update set
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0,
    used_at = null,
    sent_count = case when pay.login_codes.window_started > now() - interval '1 hour' then pay.login_codes.sent_count + 1 else 1 end,
    window_started = case when pay.login_codes.window_started > now() - interval '1 hour' then pay.login_codes.window_started else now() end;
  perform pay.log_action('session', null, 'login_code_sent', null, null, jsonb_build_object('email', v_email));
  return v_code;
end $$;

-- Null when the code is right (and marks it used); otherwise what to tell the person.
create or replace function pay.verify_login_code(p_email text, p_code text) returns text
language plpgsql security definer set search_path = pay, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  c pay.login_codes;
begin
  select * into c from pay.login_codes where email = v_email for update;
  if c.email is null then return 'No code has been sent to this email. Press “Send a new code”.'; end if;
  if c.used_at is not null then return 'That code has already been used. Press “Send a new code”.'; end if;
  if c.expires_at <= now() then return 'That code has expired. Press “Send a new code”.'; end if;
  if c.attempts >= 5 then return 'Too many wrong codes. Press “Send a new code”.'; end if;
  if c.code_hash <> crypt(trim(coalesce(p_code, '')), c.code_hash) then
    update pay.login_codes set attempts = attempts + 1 where email = v_email;
    return 'That code is not right. Check the latest email and try again.';
  end if;
  if not exists (select 1 from pay.profiles where email = v_email and active) then
    return 'This login has been deactivated. Ask David.';
  end if;
  update pay.login_codes set used_at = now() where email = v_email;
  perform pay.log_action('session', null, 'login_code_ok', null, null, jsonb_build_object('email', v_email));
  return null;
end $$;

revoke all on function pay.issue_login_code(text) from public, anon, authenticated;
revoke all on function pay.verify_login_code(text, text) from public, anon, authenticated;
grant execute on function pay.issue_login_code(text) to service_role;
grant execute on function pay.verify_login_code(text, text) to service_role;
revoke all on pay.login_codes from anon, authenticated;
