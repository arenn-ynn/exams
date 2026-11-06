-- EXAMINA — migration 2/3: Row Level Security, privileges, storage, realtime.
-- Principle: students never read exam content, attempts or answers directly.
-- They go through SECURITY DEFINER functions (migration 3) that hide answers and grades until release.

-- ───────────────────────── Helper predicates (SECURITY DEFINER avoids RLS recursion) ─────────────────────────
create function public.is_classroom_owner(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classrooms where id = cid and owner_id = auth.uid());
$$;

create function public.is_classroom_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classroom_members where classroom_id = cid and user_id = auth.uid());
$$;

create function public.owns_exam(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from exams where id = eid and owner_id = auth.uid());
$$;

create function public.owns_question(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from questions q join exams e on e.id = q.exam_id where q.id = qid and e.owner_id = auth.uid());
$$;

create function public.owns_assignment(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from assignments a join classrooms c on c.id = a.classroom_id
                 where a.id = aid and c.owner_id = auth.uid());
$$;

create function public.is_assignment_member(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from assignments a join classroom_members m on m.classroom_id = a.classroom_id
                 where a.id = aid and m.user_id = auth.uid());
$$;

create function public.owns_attempt_assignment(att uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from attempts t join assignments a on a.id = t.assignment_id
                 join classrooms c on c.id = a.classroom_id where t.id = att and c.owner_id = auth.uid());
$$;

-- Profiles are visible to yourself, to the owner of a classroom you are in, and to owners about their members.
create function public.can_view_profile(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pid = auth.uid() or exists (
    select 1 from classroom_members m join classrooms c on c.id = m.classroom_id
    where (c.owner_id = auth.uid() and m.user_id = pid) or (m.user_id = auth.uid() and c.owner_id = pid)
  );
$$;

-- ───────────────────────── Enable RLS everywhere ─────────────────────────
alter table public.profiles          enable row level security;
alter table public.user_preferences  enable row level security;
alter table public.exams             enable row level security;
alter table public.questions         enable row level security;
alter table public.answer_options    enable row level security;
alter table public.matching_pairs    enable row level security;
alter table public.exam_versions     enable row level security;
alter table public.classrooms        enable row level security;
alter table public.classroom_members enable row level security;
alter table public.announcements     enable row level security;
alter table public.assignments       enable row level security;
alter table public.attempts          enable row level security;
alter table public.student_answers   enable row level security;
alter table public.attempt_grants    enable row level security;
alter table public.result_releases   enable row level security;
alter table public.notifications     enable row level security;

-- ───────────────────────── Policies ─────────────────────────
create policy profiles_select on public.profiles for select to authenticated using (public.can_view_profile(id));
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy prefs_all on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Exams: owner reads/deletes; writes go through save_exam()/set_exam_status().
create policy exams_select on public.exams for select to authenticated using (owner_id = auth.uid());
create policy exams_delete on public.exams for delete to authenticated using (owner_id = auth.uid());
create policy questions_select on public.questions for select to authenticated using (public.owns_exam(exam_id));
create policy options_select on public.answer_options for select to authenticated using (public.owns_question(question_id));
create policy pairs_select on public.matching_pairs for select to authenticated using (public.owns_question(question_id));
create policy versions_select on public.exam_versions for select to authenticated using (public.owns_exam(exam_id));

-- Classrooms
create policy classrooms_select on public.classrooms for select to authenticated
  using (owner_id = auth.uid() or public.is_classroom_member(id));
create policy classrooms_update on public.classrooms for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy classrooms_delete on public.classrooms for delete to authenticated
  using (owner_id = auth.uid() and not exists (select 1 from public.assignments a where a.classroom_id = classrooms.id));

create policy members_select on public.classroom_members for select to authenticated
  using (user_id = auth.uid() or public.is_classroom_owner(classroom_id));
create policy members_delete on public.classroom_members for delete to authenticated
  using (user_id = auth.uid() or public.is_classroom_owner(classroom_id));

create policy announcements_select on public.announcements for select to authenticated
  using (public.is_classroom_owner(classroom_id) or public.is_classroom_member(classroom_id));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.is_classroom_owner(classroom_id) and author_id = auth.uid());
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_classroom_owner(classroom_id)) with check (public.is_classroom_owner(classroom_id));
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_classroom_owner(classroom_id));

-- Assignments: owner + members read; delete only while nobody has attempted it.
create policy assignments_select on public.assignments for select to authenticated
  using (public.is_classroom_owner(classroom_id) or public.is_classroom_member(classroom_id));
create policy assignments_delete on public.assignments for delete to authenticated
  using (public.is_classroom_owner(classroom_id) and not exists (select 1 from public.attempts t where t.assignment_id = assignments.id));

-- Attempts / answers contain grades and correctness: ONLY the classroom owner can read them directly.
create policy attempts_select on public.attempts for select to authenticated using (public.owns_assignment(assignment_id));
create policy answers_select on public.student_answers for select to authenticated using (public.owns_attempt_assignment(attempt_id));
create policy grants_select on public.attempt_grants for select to authenticated
  using (public.owns_assignment(assignment_id) or user_id = auth.uid());
create policy releases_select on public.result_releases for select to authenticated using (public.owns_assignment(assignment_id));

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ───────────────────────── Table privileges (defence in depth) ─────────────────────────
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.exams, public.questions, public.answer_options, public.matching_pairs,
  public.exam_versions, public.classroom_members, public.assignments, public.attempts, public.student_answers,
  public.attempt_grants, public.result_releases from authenticated;
grant delete on public.exams, public.assignments to authenticated;
revoke insert, update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke insert, update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
revoke insert, update on public.classrooms from authenticated;
grant update (name, description, enrollment_open, archived) on public.classrooms to authenticated;

-- ───────────────────────── Storage: public avatars bucket, each user writes only inside their own folder ─────────────────────────
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────────────────── Realtime (RLS applies to realtime too) ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.attempts;
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
