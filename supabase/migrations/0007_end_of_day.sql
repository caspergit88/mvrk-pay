-- MVRK Pay — the end-of-day report, computed in the database.

-- The nightly job runs as the service role, which has no profile. PostgREST
-- puts the key's role in the JWT claims; this reads it back.
create or replace function pay.is_service() returns boolean
language sql stable as $$
  select coalesce(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    ) = 'service_role',
    false)
$$;

-- ---------------------------------------------------------------------------
-- Everything the report page and the PDF print: lines in time order, totals
-- by provider and by cashier, the day's close if any, and payments that landed
-- today for an earlier, already-closed day ("late"). Money is summed here,
-- never in TypeScript (CONVENTIONS.md).
-- ---------------------------------------------------------------------------
create or replace function pay.report_data(p_location uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = pay as $$
declare l pay.locations; v_lines jsonb; v_prov jsonb; v_cash jsonb; v_tot jsonb; v_close jsonb; v_late jsonb; v_desks jsonb;
begin
  select * into l from pay.locations where id = p_location;
  if l.id is null then raise exception 'Unknown location.'; end if;
  if not (pay.is_service() or pay.is_finance() or pay.my_location() = p_location) then raise exception 'Not your location.' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at), '[]'::jsonb) into v_lines
  from (select id, created_at, merchant_ref, provider_name, provider_kind, cashier_name, note, booking_ref, amount_minor, currency,
               status, closed_reason, display_status, card_scheme, card_last4, paid_at, late, desk_slug
        from pay.v_transactions where location_id = p_location and business_date = p_date) v;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.provider_name), '[]'::jsonb) into v_prov
  from (select provider_name, currency,
               count(*) filter (where status = 'paid') as paid_count,
               coalesce(sum(amount_minor) filter (where status = 'paid'), 0) as paid_minor,
               count(*) filter (where status = 'refunded') as refunded_count,
               coalesce(sum(amount_minor) filter (where status = 'refunded'), 0) as refunded_minor
        from pay.v_transactions where location_id = p_location and business_date = p_date
        group by provider_name, currency) v;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.cashier_name), '[]'::jsonb) into v_cash
  from (select cashier_name, currency,
               count(*) filter (where status = 'paid') as paid_count,
               coalesce(sum(amount_minor) filter (where status = 'paid'), 0) as paid_minor
        from pay.v_transactions where location_id = p_location and business_date = p_date
        group by cashier_name, currency) v;

  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_tot
  from pay.v_day_totals v where v.location_id = p_location and v.business_date = p_date;

  select to_jsonb(c) into v_close from (
    select dc.id, dc.close_number, dc.closed_at, dc.automatic, dc.reopened_at, dc.reopen_reason, dc.report_path, p.full_name as closed_by_name
    from pay.day_closes dc left join pay.profiles p on p.id = dc.closed_by
    where dc.location_id = p_location and dc.business_date = p_date) c;

  -- Paid today, but belonging to an earlier day that had already been closed.
  select coalesce(jsonb_agg(to_jsonb(v) order by v.paid_at), '[]'::jsonb) into v_late
  from (select id, business_date, paid_at, merchant_ref, cashier_name, amount_minor, currency, card_last4
        from pay.v_transactions
        where location_id = p_location and late and paid_at is not null
          and (paid_at at time zone l.timezone)::date = p_date and business_date < p_date) v;

  select coalesce(jsonb_agg(d.slug order by d.slug), '[]'::jsonb) into v_desks from pay.desks d where d.location_id = p_location and d.active;

  return jsonb_build_object(
    'location', jsonb_build_object('id', l.id, 'name', l.name, 'slug', l.slug, 'timezone', l.timezone, 'finance_email', l.finance_email),
    'date', p_date, 'desks', v_desks,
    'lines', v_lines, 'byProvider', v_prov, 'byCashier', v_cash, 'totals', v_tot,
    'close', v_close, 'lateFromEarlierDays', v_late,
    'generatedAt', now());
end $$;
grant execute on function pay.report_data(uuid, date) to authenticated, service_role;

-- Totals over a date range for the transaction list (one location or all of
-- them). Under RLS through the view, so each role sees its own locations.
create or replace function pay.range_totals(p_location uuid, p_from date, p_to date)
returns table (currency text, paid_count bigint, paid_minor bigint, refunded_count bigint, refunded_minor bigint, not_confirmed_count bigint)
language sql stable security invoker set search_path = pay as $$
  select currency,
         count(*) filter (where status = 'paid'),
         coalesce(sum(amount_minor) filter (where status = 'paid'), 0),
         count(*) filter (where status = 'refunded'),
         coalesce(sum(amount_minor) filter (where status = 'refunded'), 0),
         count(*) filter (where display_status = 'Not confirmed')
  from pay.v_transactions
  where (p_location is null or location_id = p_location) and business_date between p_from and p_to
  group by currency
$$;
grant execute on function pay.range_totals(uuid, date, date) to authenticated, service_role;

-- The codes still waiting or never confirmed on a day: End of day checks these first.
create or replace function pay.unresolved_for_day(p_location uuid, p_date date) returns setof pay.transactions
language sql stable security definer set search_path = pay as $$
  select t.* from pay.transactions t
  where t.location_id = p_location and t.business_date = p_date
    and (t.status = 'waiting' or (t.status = 'closed' and (t.last_checked_at is null or t.last_error is not null)))
    and (pay.is_service() or pay.is_finance() or pay.my_location() = p_location)
$$;
grant execute on function pay.unresolved_for_day(uuid, date) to authenticated, service_role;

-- Locations whose business day should close now: local time is past the
-- logout time and today has no close yet. The nightly job calls this.
create or replace function pay.locations_due_for_close() returns table (location_id uuid, business_date date)
language sql stable security definer set search_path = pay as $$
  select l.id, (now() at time zone l.timezone)::date
  from pay.locations l
  where l.active
    and (now() at time zone l.timezone)::time >= l.logout_time
    and not exists (select 1 from pay.day_closes dc where dc.location_id = l.id and dc.business_date = (now() at time zone l.timezone)::date and dc.reopened_at is null)
$$;
revoke all on function pay.locations_due_for_close() from public, anon, authenticated;
grant execute on function pay.locations_due_for_close() to service_role;

-- An audit line the app writes itself (a CSV export, a report print) — the
-- triggers only see table changes.
create or replace function pay.note_audit(p_entity text, p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = pay as $$
  insert into pay.audit_log (actor, entity, entity_id, action, after) values (auth.uid(), p_entity, null, p_action, p_detail)
$$;
grant execute on function pay.note_audit(text, text, jsonb) to authenticated, service_role;

-- Where the PDFs go. Private; the app serves them through signed URLs.
insert into storage.buckets (id, name, public) values ('pay-reports', 'pay-reports', false) on conflict (id) do nothing;

-- The close records where its PDF landed.
create or replace function pay.set_report_path(p_close uuid, p_path text) returns void
language sql security definer set search_path = pay as $$
  update pay.day_closes set report_path = p_path where id = p_close
$$;
revoke all on function pay.set_report_path(uuid, text) from public, anon, authenticated;
grant execute on function pay.set_report_path(uuid, text) to service_role;
