-- MVRK Pay — a Manager role beside Finance.
--
-- Until now the one read-everything role was stored as 'finance' and shown
-- as "Manager". The team wants both titles: Mo is the Manager, Naiem is
-- Finance. They get the same access (every location, nothing in Settings).
--
-- A new enum value can only be used once it is committed, and each migration
-- runs in its own transaction, so this file only adds it; 0015 uses it.

alter type pay.app_role add value if not exists 'manager' after 'admin';
