# Browser / integration harness (optional)

Used for the production audit (see `../../AUDIT.md`). It runs the **real** frontend in Chromium against the **real** migrations, RLS policies and RPC functions in PostgreSQL, exposed through PostgREST. Supabase Auth (GoTrue) and Realtime are **not** part of it: sessions are locally signed JWTs injected into `localStorage`, and realtime simply doesn't connect (the app is designed to work without it).

Prerequisites: PostgreSQL ≥ 14 (superuser access), the PostgREST binary, Node, `pip install playwright && playwright install chromium`.

```bash
export PGUSER=postgres PGHOST=localhost PGPASSWORD=...       # superuser
bash tests/e2e/setup_db.sh                                   # creates DB "e2e" with migrations + seed data
POSTGREST_BIN=/path/to/postgrest bash tests/e2e/start_backend.sh &   # :3000 PostgREST, :54321 proxy
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=x npm run build
npx vite preview --port 4174 &
python3 tests/e2e/audit.py http://127.0.0.1:4174 "" teacher,student1 320,360,375,390,430,768,1024,1280,1440,1920
python3 tests/e2e/journey_take.py; python3 tests/e2e/journey_nav.py; python3 tests/e2e/journey_teacher.py; python3 tests/e2e/journey_edge.py
```

Notes: the audit takes several minutes for the whole matrix (pass a subset of roles/widths to shard it). The seed contains deliberately hostile data (very long unbroken names/titles). Seeded exam windows are wide so the data doesn't expire; `journey_take.py` deletes the student's attempt before it starts. These scripts mutate the `e2e` database; re-run `setup_db.sh` to reset it.
