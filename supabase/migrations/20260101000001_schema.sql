-- EXAMINA — migration 1/3: tables, indexes and auth triggers.
-- Run migrations in order (1 → 2 → 3) in the Supabase SQL editor, or with `supabase db push`.

-- ───────────────────────── Profiles & preferences ─────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.user_preferences (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  theme      text not null default 'system' check (theme in ('light','dark','system')),
  accent     text not null default 'blue' check (accent in ('blue','purple','green','orange','pink','red','cyan')),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- ───────────────────────── Examinations (editable source of truth) ─────────────────────────
create table public.exams (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 200),
  description        text not null default '' check (char_length(description) <= 5000),
  duration_minutes   int  not null default 60 check (duration_minutes between 1 and 600),
  passing_grade      numeric(5,2) not null default 50 check (passing_grade between 0 and 100),
  randomize_options  boolean not null default true,
  free_navigation    boolean not null default true,
  status             text not null default 'draft' check (status in ('draft','published','archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index exams_owner_idx on public.exams (owner_id, updated_at desc);

create table public.questions (
  id        uuid primary key default gen_random_uuid(),
  exam_id   uuid not null references public.exams(id) on delete cascade,
  position  int  not null check (position >= 1),
  type      text not null check (type in ('single_choice','multiple_choice','matching')),
  text      text not null check (char_length(btrim(text)) between 1 and 5000),
  points    numeric(6,2) not null default 1 check (points > 0 and points <= 1000)
);
create index questions_exam_idx on public.questions (exam_id, position);

create table public.answer_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  position     int  not null,
  text         text not null check (char_length(btrim(text)) between 1 and 1000),
  is_correct   boolean not null default false
);
create index answer_options_q_idx on public.answer_options (question_id, position);

create table public.matching_pairs (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  position     int  not null,
  left_text    text not null check (char_length(btrim(left_text)) between 1 and 1000),
  right_text   text not null check (char_length(btrim(right_text)) between 1 and 1000)
);
create index matching_pairs_q_idx on public.matching_pairs (question_id, position);

-- Immutable snapshots: an assignment always points at the exact content students were given.
create table public.exam_versions (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references public.exams(id) on delete cascade,
  version_number  int  not null,
  content_hash    text not null,
  snapshot        jsonb not null,
  created_at      timestamptz not null default now(),
  unique (exam_id, version_number),
  unique (exam_id, content_hash)
);

-- ───────────────────────── Classrooms ─────────────────────────
create table public.classrooms (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  description      text not null default '' check (char_length(description) <= 2000),
  join_code        text not null unique,
  enrollment_open  boolean not null default true,
  archived         boolean not null default false,
  created_at       timestamptz not null default now()
);
create index classrooms_owner_idx on public.classrooms (owner_id, created_at desc);

create table public.classroom_members (
  classroom_id  uuid not null references public.classrooms(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  primary key (classroom_id, user_id)
);
create index classroom_members_user_idx on public.classroom_members (user_id);

create table public.announcements (
  id            uuid primary key default gen_random_uuid(),
  classroom_id  uuid not null references public.classrooms(id) on delete cascade,
  author_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  message       text not null check (char_length(btrim(message)) between 1 and 5000),
  published_at  timestamptz not null default now()
);
create index announcements_class_idx on public.announcements (classroom_id, published_at desc);

-- ───────────────────────── Assignments (exam → classroom, with its own schedule) ─────────────────────────
create table public.assignments (
  id                   uuid primary key default gen_random_uuid(),
  classroom_id         uuid not null references public.classrooms(id) on delete cascade,
  exam_id              uuid not null references public.exams(id),
  exam_version_id      uuid not null references public.exam_versions(id),
  starts_at            timestamptz not null,
  closes_at            timestamptz not null,
  results_released_at  timestamptz,
  created_by           uuid not null references public.profiles(id) on delete cascade,
  created_at           timestamptz not null default now(),
  check (closes_at > starts_at)
);
create index assignments_class_idx on public.assignments (classroom_id, starts_at desc);
create index assignments_exam_idx on public.assignments (exam_id);

create table public.attempts (
  id              uuid primary key default gen_random_uuid(),
  assignment_id   uuid not null references public.assignments(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  attempt_number  int  not null check (attempt_number >= 1),
  status          text not null default 'in_progress' check (status in ('in_progress','submitted')),
  started_at      timestamptz not null default now(),
  deadline_at     timestamptz not null,
  submitted_at    timestamptz,
  auto_submitted  boolean not null default false,
  score           numeric(8,2),
  max_score       numeric(8,2),
  percent         numeric(5,2),
  passed          boolean,
  shuffle         jsonb not null default '{}'::jsonb,
  salt            uuid not null default gen_random_uuid(),
  unique (assignment_id, user_id, attempt_number)
);
create unique index attempts_one_open_idx on public.attempts (assignment_id, user_id) where status = 'in_progress';
create index attempts_user_idx on public.attempts (user_id);

create table public.student_answers (
  attempt_id       uuid not null references public.attempts(id) on delete cascade,
  question_id      uuid not null,
  answer           jsonb not null default '{}'::jsonb check (octet_length(answer::text) < 20000),
  is_answered      boolean,
  is_correct       boolean,
  points_awarded   numeric(6,2),
  updated_at       timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.attempt_grants (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  granted_by     uuid not null references public.profiles(id) on delete cascade,
  reason         text not null check (char_length(btrim(reason)) between 1 and 1000),
  created_at     timestamptz not null default now()
);
create index attempt_grants_idx on public.attempt_grants (assignment_id, user_id);

create table public.result_releases (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references public.assignments(id) on delete cascade,
  released_by         uuid not null references public.profiles(id) on delete cascade,
  released_at         timestamptz not null default now(),
  forced              boolean not null default false,
  submitted_count     int not null default 0,
  not_submitted_count int not null default 0
);

-- ───────────────────────── Notifications ─────────────────────────
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text not null default '',
  link        text,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
