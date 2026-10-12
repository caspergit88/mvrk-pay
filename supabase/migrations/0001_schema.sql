-- MVRK Pay — Phase 1 schema (draft, check-in 1)
--
-- Everything lives in schema `pay`, inside the Supabase project the weddings app
-- uses. Nothing here touches `public`. Money is integer minor units with a
-- currency code beside it (card amounts, not contract values). Timezone per
-- location; all four are Africa/Cairo today.
--
-- Applied by scripts/setup-database.ts, which tracks what has run in
-- pay._migrations — a separate tracker from the weddings app's public._migrations.

create schema if not exists pay;
-- gen_random_bytes (display keys) and crypt (staff PINs) come from pgcrypto; Supabase ships it in `extensions`.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type pay.app_role as enum ('admin', 'finance', 'reception');

-- The lifecycle a payment code goes through. `closed_reason` says why a code
-- left the display; the provider's own word is kept separately in
-- transactions.provider_state so nothing is lost in translation.
create type pay.tx_status as enum ('waiting', 'paid', 'closed', 'refunded');
create type pay.closed_reason as enum ('done', 'cleared', 'replaced', 'expired');

create type pay.provider_kind as enum ('ngenius', 'getpayin', 'nomod', 'stripe', 'mock');

-- ---------------------------------------------------------------------------
-- Locations and desks
-- ---------------------------------------------------------------------------
create table pay.locations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  name text not null,
  -- The email domain that puts a login at this location. Lower-case, no @.
  email_domain text not null unique check (email_domain = lower(email_domain) and email_domain !~ '@'),
  timezone text not null default 'Africa/Cairo',
  brand_label text not null default 'MVRK',
  idle_text text not null default 'Ready when you are',
  -- Where the end-of-day report goes. Null = nobody is emailed (the report still closes).
  finance_email text,
  max_amount_minor integer not null default 5000000 check (max_amount_minor > 0),
  order_expiry_min integer not null default 20 check (order_expiry_min between 1 and 240),
  logout_time time not null default '22:00',
  require_pin boolean not null default true,
  wifi_ssid text,
  wifi_password text,
  wifi_security text not null default 'WPA' check (wifi_security in ('WPA', 'WEP', 'nopass')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pay.desks (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references pay.locations (id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  name text not null,
  -- What the display URL carries. Random, regenerable from Settings; never a login.
  display_key text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, slug)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
-- A login. Exists only for people created through MVRK Pay; the weddings app
-- keeps its own profiles table in public and never sees this one.
create table pay.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(email)),
  full_name text not null,
  role pay.app_role not null default 'reception',
  -- Reception belongs to one location. Admin and finance see all and have none.
  location_id uuid references pay.locations (id),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role = 'reception') = (location_id is not null))
);

-- The names in the "Who are you?" dropdown. Not logins: a shared reception
-- account signs in, then a person picks their own name (and PIN).
create table pay.staff (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references pay.locations (id),
  name text not null,
  -- bcrypt via pgcrypto's crypt(); null = no PIN set for this person yet.
  pin_hash text,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, name)
);

-- Who is on the desk right now, and until when. One row per Supabase session.
-- requireProfile() refuses a missing or expired row and reopens "Who are you?".
create table pay.sessions (
  session_id uuid primary key,
  profile_id uuid not null references pay.profiles (id) on delete cascade,
  staff_id uuid references pay.staff (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_expires_at on pay.sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Payment providers (max five in total — enforced in 0002)
-- ---------------------------------------------------------------------------
create table pay.providers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references pay.locations (id),
  kind pay.provider_kind not null,
  name text not null,
  currency char(3) not null default 'EUR' check (currency = upper(currency)),
  enabled boolean not null default true,
  is_default boolean not null default false,
  -- Name of the Supabase Vault secret (or env var) holding the API key. The
  -- value itself is never in this table and never leaves the server.
  credential_ref text,
  -- Non-secret settings: outlet reference, environment (live/sandbox), realm.
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, name)
);
-- At most one default per location.
create unique index providers_one_default_per_location on pay.providers (location_id) where is_default;

-- ---------------------------------------------------------------------------
-- Transactions: the record finance reconciles. Never deleted.
-- ---------------------------------------------------------------------------
create table pay.transactions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references pay.locations (id),
  desk_id uuid not null references pay.desks (id),
  provider_id uuid not null references pay.providers (id),
  provider_kind pay.provider_kind not null,
  -- The provider's own id for the order (N-Genius order reference).
  provider_ref text not null,
  -- Ours: letters, digits and hyphens; shows in the provider's portal.
  merchant_ref text not null unique check (merchant_ref ~ '^[A-Z0-9-]{6,64}$'),
  amount_minor integer not null check (amount_minor > 0),
  currency char(3) not null,
  note text not null default '' check (length(note) <= 80),
  -- "KiteHub booking #": the line finance matches on.
  booking_ref text not null default '' check (length(booking_ref) <= 40),
  staff_id uuid references pay.staff (id),
  -- Kept as text too, so a renamed or removed staff row never changes history.
  cashier_name text not null,
  created_by uuid not null references pay.profiles (id),
  status pay.tx_status not null default 'waiting',
  closed_reason pay.closed_reason,
  -- What the provider last said, verbatim (STARTED, PURCHASED, FAILED, …).
  provider_state text not null default 'STARTED',
  failed_attempts integer not null default 0,
  card_scheme text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  pay_url text not null,
  qr_svg text not null,
  paid_at timestamptz,
  refunded_at timestamptz,
  -- Set only by a successful provider check. Null + closed = "Not confirmed".
  last_checked_at timestamptz,
  last_error text,
  expires_at timestamptz not null,
  -- Calendar date at the location when the code was created; reports group by it.
  business_date date not null,
  -- Set when the payment landed after the day it belongs to was closed.
  late boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, provider_ref),
  check ((status = 'closed') = (closed_reason is not null)),
  check (status <> 'paid' or paid_at is not null)
);
create index transactions_location_day on pay.transactions (location_id, business_date, created_at desc);
create index transactions_desk_recent on pay.transactions (desk_id, created_at desc);
create index transactions_waiting on pay.transactions (expires_at) where status = 'waiting';

-- What is on each customer display right now. One row per desk; every change
-- bumps `version` and Realtime fans the row out to the screens.
create table pay.desk_state (
  desk_id uuid primary key references pay.desks (id) on delete cascade,
  current_tx uuid references pay.transactions (id),
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- End of day
-- ---------------------------------------------------------------------------
create table pay.day_closes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references pay.locations (id),
  business_date date not null,
  -- A readable number for the printed slip: KP-2026-10-12-001 style, assigned in 0002.
  close_number text not null unique,
  closed_at timestamptz not null default now(),
  closed_by uuid references pay.profiles (id),
  automatic boolean not null default false,
  totals jsonb not null,
  report_path text,
  reopened_at timestamptz,
  reopened_by uuid references pay.profiles (id),
  reopen_reason text,
  unique (location_id, business_date)
);

-- ---------------------------------------------------------------------------
-- Launcher tiles
-- ---------------------------------------------------------------------------
create table pay.apps (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  url text not null,
  icon text not null default 'app',
  roles pay.app_role[] not null default '{admin}',
  sort_order integer not null default 100,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Audit and email logs (append-only; 0002 adds the triggers and 0003 the policies)
-- ---------------------------------------------------------------------------
create table pay.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  entity text not null,
  entity_id text,
  action text not null,
  reason text,
  before jsonb,
  after jsonb
);
create index audit_log_entity on pay.audit_log (entity, entity_id, at desc);

create table pay.email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  location_id uuid references pay.locations (id),
  to_addresses text[] not null,
  subject text not null,
  body text not null,
  attachment_path text,
  dedupe_key text not null unique,
  sent_at timestamptz,
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
