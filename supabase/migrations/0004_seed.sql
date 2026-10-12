-- MVRK Pay — reference data (draft, check-in 1)
-- Locations are the four team email domains; one desk each. Staff names, users
-- and providers are added through Settings (or scripts/setup-database.ts for
-- the first admin). Nothing here is a secret.

insert into pay.locations (slug, name, email_domain, timezone, brand_label) values
  ('kitepeople', 'KitePeople',        'kitepeople.com',       'Africa/Cairo', 'MVRK'),
  ('mvrkhq',     'MVRK HQ',           'mvrkhq.com',           'Africa/Cairo', 'MVRK'),
  ('waspo',      'Waspo Club',        'waspoclub.com',        'Africa/Cairo', 'MVRK'),
  ('riah',       'Riah Kite Academy', 'riahkiteacademy.com',  'Africa/Cairo', 'MVRK')
on conflict (slug) do nothing;

insert into pay.desks (location_id, slug, name)
select id, 'desk-1', 'Desk 1' from pay.locations
on conflict (location_id, slug) do nothing;

insert into pay.desk_state (desk_id) select id from pay.desks on conflict do nothing;

-- Launcher tiles. The weddings URL is filled in from Settings → Apps.
insert into pay.apps (name, url, icon, roles, sort_order) values
  ('MVRK Pay', '/', 'pay', '{admin,finance,reception}', 10),
  ('Weddings', '', 'weddings', '{admin}', 20)
on conflict (name) do nothing;

-- The euro Network outlet for the first location that goes live (KitePeople).
-- The API key is not here: it is a Vault secret named by credential_ref.
insert into pay.providers (location_id, kind, name, currency, enabled, is_default, credential_ref, settings)
select id, 'ngenius', 'Network (N-Genius)', 'EUR', true, true, 'NGENIUS_API_KEY',
       '{"env": "live", "realm": "NetworkInternational", "outletRef": "85c6ced8-572f-4b64-934b-3861f4552cab"}'::jsonb
from pay.locations where slug = 'kitepeople'
on conflict (location_id, name) do nothing;
