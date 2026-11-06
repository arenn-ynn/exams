#!/usr/bin/env bash
# Creates database "e2e" from the real migrations + seed data. Needs PGUSER/PGHOST/PGPASSWORD for a superuser.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$HERE/../.." && pwd)"
psql -q -d postgres -c "drop database if exists e2e with (force)" -c "create database e2e"
psql -q -v ON_ERROR_STOP=1 -d e2e -f "$APP/tests/db/00_supabase_shim.sql"
# PostgREST exposes the JWT claims as JSON in request.jwt.claims
psql -q -d e2e -c "create or replace function auth.uid() returns uuid language sql stable as \$\$ select nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'sub','')::uuid \$\$;"
for f in "$APP"/supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d e2e -f "$f" >/dev/null; done
psql -q -d e2e -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'pw' noinherit; end if; end \$\$; grant anon, authenticated to authenticator;"
psql -q -v ON_ERROR_STOP=1 -d e2e -f "$HERE/seed.sql"
psql -q -d e2e -f "$HERE/seed2.sql"
echo "DB ready"
