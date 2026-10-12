#!/usr/bin/env bash
# Applies the migrations to a scratch Postgres (plain, not Supabase) and runs the
# acceptance tests. Needs psql on the path and PGHOST/PGUSER/PGPASSWORD (or a
# local socket). Never point this at a real project: the shim creates roles.
set -euo pipefail
DB="${TEST_DB:-mvrkpay_test}"
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -d "$DB" -c "alter database $DB set search_path = public, extensions"
for f in supabase/tests/local-supabase-shim.sql supabase/migrations/*.sql; do
  echo "== $f"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" 2>&1 | grep -v -i wal_level || true
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/acceptance.sql 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^:]*:[0-9]*: //'
