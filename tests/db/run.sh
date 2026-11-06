#!/usr/bin/env bash
# Runs all migrations + the smoke test against a throwaway local PostgreSQL database.
# Usage: PGHOST=localhost PGUSER=postgres ./tests/db/run.sh   (needs psql and a running PostgreSQL ≥ 14)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=examina_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d $DB -f tests/db/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do echo "applying $f"; psql -v ON_ERROR_STOP=1 -q -d $DB -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d $DB -f tests/db/smoke.sql
