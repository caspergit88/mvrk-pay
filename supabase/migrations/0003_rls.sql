-- MVRK Pay — Row Level Security (draft, check-in 1)
--
-- Reception sees and writes only its own location. Finance reads every location
-- and writes nothing (day re-opens go through pay.reopen_day). Admin does
-- everything. The customer display is the anon role and reads nothing directly:
-- it gets its snapshot through pay.display_snapshot(), keyed by the desk key.

grant usage on schema pay to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema pay to authenticated, service_role;
grant select on all tables in schema pay to anon;   -- RLS below leaves anon with nothing readable
grant usage, select on all sequences in schema pay to authenticated, service_role;
grant execute on all functions in schema pay to authenticated, service_role;
alter default privileges in schema pay grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema pay grant usage, select on sequences to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['locations', 'desks', 'profiles', 'staff', 'sessions', 'providers', 'transactions', 'desk_state', 'day_closes', 'apps', 'audit_log', 'email_log']
  loop
    execute format('alter table pay.%I enable row level security', t);
    execute format('alter table pay.%I force row level security', t);
  end loop;
end $$;

-- Locations: everyone signed in may read (the sign-in flow needs the domain list
-- before there is a profile, so that one read goes through a function); admin writes.
create policy locations_read on pay.locations for select using (auth.uid() is not null);
create policy locations_admin on pay.locations for all using (pay.is_admin()) with check (pay.is_admin());

-- Domain → location name for the sign-in screen, callable before sign-in.
create or replace function pay.location_for_domain(p_domain text) returns jsonb
language sql stable security definer set search_path = pay as $$
  select jsonb_build_object('slug', slug, 'name', name) from pay.locations where email_domain = lower(p_domain) and active
$$;
grant execute on function pay.location_for_domain(text) to anon, authenticated;

create policy desks_read on pay.desks for select using (pay.is_finance() or location_id = pay.my_location());
create policy desks_admin on pay.desks for all using (pay.is_admin()) with check (pay.is_admin());

create policy profiles_self on pay.profiles for select using (id = auth.uid() or pay.is_admin());
create policy profiles_admin on pay.profiles for all using (pay.is_admin()) with check (pay.is_admin());

-- Staff names: reception sees its own location's list (never the PIN hash — the
-- app selects named columns and a view is added in Phase 2 to make that a rule).
create policy staff_read on pay.staff for select using (pay.is_finance() or location_id = pay.my_location());
create policy staff_admin on pay.staff for all using (pay.is_admin()) with check (pay.is_admin());

create policy sessions_self on pay.sessions for select using (profile_id = auth.uid() or pay.is_admin());

create policy providers_read on pay.providers for select using (pay.is_finance() or location_id = pay.my_location());
create policy providers_admin on pay.providers for all using (pay.is_admin()) with check (pay.is_admin());

-- Transactions are written only through the functions in 0002; direct writes
-- are refused for everyone but admin, and never deleted by anyone.
create policy transactions_read on pay.transactions for select using (pay.is_finance() or location_id = pay.my_location());
create policy transactions_admin_update on pay.transactions for update using (pay.is_admin()) with check (pay.is_admin());

create policy desk_state_read on pay.desk_state for select using (
  pay.is_finance() or exists (select 1 from pay.desks d where d.id = desk_id and d.location_id = pay.my_location())
);

create policy day_closes_read on pay.day_closes for select using (pay.is_finance() or location_id = pay.my_location());

create policy apps_read on pay.apps for select using (auth.uid() is not null and pay.my_role() = any (roles));
create policy apps_admin on pay.apps for all using (pay.is_admin()) with check (pay.is_admin());

-- Logs: finance and admin read; nobody updates or deletes (rules in 0002 back this up).
create policy audit_log_read on pay.audit_log for select using (pay.is_finance());
create policy email_log_read on pay.email_log for select using (pay.is_finance());
