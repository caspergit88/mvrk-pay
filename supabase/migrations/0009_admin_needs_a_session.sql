-- MVRK Pay — admin and finance powers need a live session, not just a login.
--
-- Until now RLS trusted the Supabase login alone: pay.sessions (the 22:00
-- expiry) and the admin's emailed code (0008) guarded the app's screens, but
-- someone holding an admin password could still call the Data API directly.
-- From here, is_admin() and is_finance() also need the pay.sessions row for
-- the token's own session — the row that start_session writes only after the
-- code step (admin) or at sign-in (finance), and that the nightly job removes.
--
-- Reception is unchanged: it reads its location's staff list on "Who are
-- you?", before its session exists, and its writes already go through
-- functions that check the session.

create or replace function pay.has_live_session() returns boolean
language sql stable security definer set search_path = pay as $$
  select exists (
    select 1 from pay.sessions
    where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and profile_id = auth.uid()
      and expires_at > now()
  )
$$;

create or replace function pay.is_admin() returns boolean
language sql stable security definer set search_path = pay as $$
  select coalesce(pay.my_role() = 'admin', false) and pay.has_live_session()
$$;

create or replace function pay.is_finance() returns boolean
language sql stable security definer set search_path = pay as $$
  select coalesce(pay.my_role() in ('admin', 'finance'), false) and pay.has_live_session()
$$;

grant execute on function pay.has_live_session() to authenticated, service_role;
