-- MVRK Pay — Manager and Finance: the same access, two titles.
--
-- Both see every location's transactions, reports and exports, re-open a
-- closed day with a reason, and change nothing in Settings. Neither takes a
-- payment. Everything that asks "may this person read everything?" goes
-- through pay.is_finance(), so that is the one place that learns the new role.

create or replace function pay.is_finance() returns boolean
language sql stable security definer set search_path = pay as $$
  select coalesce(pay.my_role() in ('admin', 'manager', 'finance'), false) and pay.has_live_session()
$$;

-- Everyone made as "Manager" so far was stored as 'finance' (only Mo): they keep their title.
update pay.profiles set role = 'manager' where role = 'finance';

-- Launcher tiles open to finance open to managers too.
update pay.apps set roles = array_append(roles, 'manager'::pay.app_role)
where 'finance'::pay.app_role = any (roles) and not ('manager'::pay.app_role = any (roles));
