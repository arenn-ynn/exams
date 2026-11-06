#!/usr/bin/env bash
# Starts PostgREST (port 3000) and the tiny CORS proxy that presents it as a Supabase URL on :54321.
# Needs the PostgREST binary: https://github.com/PostgREST/postgrest/releases  (set POSTGREST_BIN, default ./postgrest)
cd "$(dirname "$0")"
PGRST_DB_URI="postgres://authenticator:pw@localhost:5432/e2e" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long" PGRST_SERVER_PORT=3000 "${POSTGREST_BIN:-./postgrest}" &
node proxy.cjs &
wait
