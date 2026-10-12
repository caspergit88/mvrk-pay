-- MVRK Pay — what the payment screens and the provider adapters need.

-- ---------------------------------------------------------------------------
-- Views obey the caller's RLS. Without this a view runs with its owner's
-- rights, and reception could read every location's transactions through it.
-- ---------------------------------------------------------------------------
alter view pay.v_transactions set (security_invoker = true);
alter view pay.v_day_totals set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Provider API keys live in Supabase Vault under the name on the provider row.
-- Only the service role may read them; the app does so inside the adapter.
-- ---------------------------------------------------------------------------
create or replace function pay.read_secret(p_name text) returns text
language plpgsql security definer set search_path = pay as $$
declare v text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
  exception when undefined_table or insufficient_privilege or invalid_schema_name then
    return null;   -- no Vault here (local Postgres); the app falls back to the environment
  end;
  return v;
end $$;
revoke all on function pay.read_secret(text) from public, anon, authenticated;
grant execute on function pay.read_secret(text) to service_role;

-- ---------------------------------------------------------------------------
-- The display is addressed by location and desk, e.g. /display/kitepeople/desk-1.
-- Two locations may both have a "desk-1"; the key settles it, but the slugs make
-- the link readable and the lookup exact.
-- ---------------------------------------------------------------------------
create or replace function pay.desk_for_display(p_location text, p_desk text, p_key text) returns uuid
language sql stable security definer set search_path = pay as $$
  select d.id from pay.desks d join pay.locations l on l.id = d.location_id
  where l.slug = p_location and d.slug = p_desk and d.display_key = p_key and d.active and l.active
$$;

create or replace function pay.display_snapshot(p_location text, p_desk text, p_key text) returns jsonb
language plpgsql stable security definer set search_path = pay as $$
declare d pay.desks; l pay.locations; ds pay.desk_state; tx pay.transactions;
begin
  select dd.* into d from pay.desks dd join pay.locations ll on ll.id = dd.location_id
  where ll.slug = p_location and dd.slug = p_desk and dd.display_key = p_key and dd.active and ll.active;
  if d.id is null then raise exception 'Unknown desk or wrong display key.' using errcode = '28000'; end if;
  select * into l from pay.locations where id = d.location_id;
  select * into ds from pay.desk_state where desk_id = d.id;
  if ds.current_tx is not null then select * into tx from pay.transactions where id = ds.current_tx; end if;
  return jsonb_build_object(
    'deskId', d.id,
    'version', coalesce(ds.version, 0),
    'now', now(),
    'brand', l.brand_label,
    'idleText', l.idle_text,
    'wifi', case when coalesce(l.wifi_ssid, '') <> '' then jsonb_build_object('ssid', l.wifi_ssid, 'password', l.wifi_password, 'security', l.wifi_security) end,
    'current', case when tx.id is null then null else jsonb_build_object(
      'id', tx.id, 'status', tx.status, 'closedReason', tx.closed_reason,
      'amountMinor', tx.amount_minor, 'currency', tx.currency, 'note', tx.note,
      'qrSvg', tx.qr_svg, 'failedAttempts', tx.failed_attempts,
      'paidAt', tx.paid_at, 'expiresAt', tx.expires_at, 'updatedAt', tx.updated_at) end
  );
end $$;
revoke all on function pay.display_snapshot(text, text, text) from public;
grant execute on function pay.display_snapshot(text, text, text), pay.desk_for_display(text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What the staff screen shows: the desk's current code (every field it may
-- see) and today's recent list, in one call.
-- ---------------------------------------------------------------------------
create or replace function pay.desk_snapshot(p_desk uuid) returns jsonb
language plpgsql stable security definer set search_path = pay as $$
declare d pay.desks; ds pay.desk_state; cur jsonb; recent jsonb; v_today date;
begin
  select * into d from pay.desks where id = p_desk;
  if d.id is null then raise exception 'Unknown desk.'; end if;
  if not (pay.is_finance() or d.location_id = pay.my_location()) then raise exception 'Not your location.' using errcode = '42501'; end if;
  select * into ds from pay.desk_state where desk_id = p_desk;
  v_today := pay.business_date_for(d.location_id);
  select to_jsonb(v) into cur from pay.v_transactions v where v.id = ds.current_tx;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc), '[]'::jsonb) into recent
  from (select * from pay.v_transactions where desk_id = p_desk and business_date >= v_today - 1 and (id is distinct from ds.current_tx) order by created_at desc limit 12) v;
  return jsonb_build_object('deskId', d.id, 'version', coalesce(ds.version, 0), 'now', now(), 'businessDate', v_today, 'current', cur, 'recent', recent);
end $$;
grant execute on function pay.desk_snapshot(uuid) to authenticated, service_role;

-- A webhook token per provider row, so the provider's callback URL carries
-- something only we know. Non-secret settings stay in `settings`; this is a
-- column so it is never printed with them.
alter table pay.providers add column if not exists webhook_token text not null default encode(extensions.gen_random_bytes(16), 'hex');
