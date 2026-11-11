-- MVRK Pay — the nightly close skips a location with nothing to close.
--
-- A location stays active when it has no desk of its own (MVRK HQ: the head
-- office, whose email domain the admin logins use), and until now the nightly
-- job wrote an empty "end of day" for it every night. It is now due only when
-- it has an active desk — or when it took payments that day, so a desk
-- switched off after taking money still gets its day closed and reported.
-- The End of day button is unchanged.

create or replace function pay.locations_due_for_close() returns table (location_id uuid, business_date date)
language sql stable security definer set search_path = pay as $$
  select l.id, (now() at time zone l.timezone)::date
  from pay.locations l
  where l.active
    and (now() at time zone l.timezone)::time >= l.logout_time
    and not exists (select 1 from pay.day_closes dc where dc.location_id = l.id and dc.business_date = (now() at time zone l.timezone)::date and dc.reopened_at is null)
    and (
      exists (select 1 from pay.desks d where d.location_id = l.id and d.active)
      or exists (select 1 from pay.transactions t where t.location_id = l.id and t.business_date = (now() at time zone l.timezone)::date)
    )
$$;
revoke all on function pay.locations_due_for_close() from public, anon, authenticated;
grant execute on function pay.locations_due_for_close() to service_role;
