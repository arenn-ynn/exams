-- EXAMINA — migration 4: fixes found during the production audit. Safe to apply on top of migrations 1-3 (idempotent).

-- 1) generate_my_reminders() always failed with  "invalid input syntax for type json".
--    In SQL, `||` and `->>` share the same precedence and associate left-to-right, so
--      'Upcoming examination: ' || v.snapshot->>'title'
--    was parsed as  ('Upcoming examination: ' || v.snapshot) ->> 'title'  (text || jsonb → cast error).
--    The client calls this function on every page load, so every user got an HTTP 400 and
--    "upcoming examination" reminders were never created. The jsonb access is now parenthesised.
create or replace function public.generate_my_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth();
begin
  insert into notifications (user_id, type, title, body, link, dedupe_key)
  select uid, 'reminder', 'Upcoming examination: ' || (v.snapshot->>'title'),
         c.name || ' — starts ' || to_char(a.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', '/take/' || a.id, 'reminder:' || a.id
  from assignments a join classrooms c on c.id = a.classroom_id
  join exam_versions v on v.id = a.exam_version_id
  join classroom_members m on m.classroom_id = c.id and m.user_id = uid
  where a.starts_at > now() and a.starts_at <= now() + interval '24 hours'
  on conflict (user_id, dedupe_key) do nothing;
end $$;

-- 2) Avatars: a user must be able to SELECT their own objects. Storage deletes (removing a replaced avatar) and
--    upserts need a SELECT policy in addition to INSERT/UPDATE/DELETE. Public reads of the public bucket are unaffected.
drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
