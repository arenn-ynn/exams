-- EXAMINA — migration 3/3: server-side business logic (SECURITY DEFINER RPC functions).
-- Timer validation, grading, shuffling, result release and attempt grants all happen here, never in the browser.

-- ───────────────────────── Internal helpers (not callable by clients; see REVOKE at the bottom) ─────────────────────────
create function public.require_auth() returns uuid language plpgsql stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  return uid;
end $$;

create function public.notify_user(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_key text default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, body, link, dedupe_key)
  values (p_user, p_type, p_title, coalesce(p_body, ''), p_link, p_key)
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- 8-character code from an unambiguous alphabet (no 0/O/1/I), uniform over 32 symbols.
create function public.gen_join_code() returns text language plpgsql volatile as $$
declare chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text; i int; b1 bytea; b2 bytea;
begin
  loop
    b1 := uuid_send(gen_random_uuid()); b2 := uuid_send(gen_random_uuid()); code := '';
    for i in 0..7 loop
      code := code || substr(chars, 1 + (get_byte(case when i < 6 then b1 else b2 end, 10 + (i % 6)) % 32), 1);
    end loop;
    exit when not exists (select 1 from classrooms where join_code = code);
  end loop;
  return code;
end $$;

create function public.build_exam_snapshot(p_exam uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', e.title, 'description', e.description, 'durationMinutes', e.duration_minutes,
    'passingGrade', e.passing_grade, 'randomizeOptions', e.randomize_options, 'freeNavigation', e.free_navigation,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'text', q.text, 'points', q.points,
        'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text, 'correct', o.is_correct) order by o.position)
                             from answer_options o where o.question_id = q.id), '[]'::jsonb),
        'pairs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'left', p.left_text, 'right', p.right_text) order by p.position)
                           from matching_pairs p where p.question_id = q.id), '[]'::jsonb)
      ) order by q.position) from questions q where q.exam_id = e.id), '[]'::jsonb))
  from exams e where e.id = p_exam;
$$;

-- Scoring policy: a question earns full points only for a fully correct answer
-- (single: the one correct option; multiple: exactly the correct set; matching: every pair correct). No negative marking.
create function public.grade_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare att attempts%rowtype; snap jsonb; q jsonb; ans jsonb; sel text[]; corr text[];
        v_answered boolean; v_ok boolean; v_pts numeric; v_total numeric := 0; v_max numeric := 0; v_pct numeric;
begin
  select * into att from attempts where id = p_attempt;
  select v.snapshot into snap from assignments a join exam_versions v on v.id = a.exam_version_id where a.id = att.assignment_id;
  for q in select * from jsonb_array_elements(snap->'questions') loop
    ans := null;
    select answer into ans from student_answers where attempt_id = p_attempt and question_id = (q->>'id')::uuid;
    if q->>'type' = 'matching' then
      v_answered := ans is not null and jsonb_typeof(ans->'matches') = 'object' and exists (select 1 from jsonb_each_text(ans->'matches'));
      v_ok := v_answered and not exists (
        select 1 from jsonb_array_elements(q->'pairs') p
        where coalesce(ans->'matches'->>(p->>'id'), '') <> md5(att.salt::text || (p->>'id')));
    else
      sel := case when ans is not null and jsonb_typeof(ans->'selected') = 'array'
                  then array(select jsonb_array_elements_text(ans->'selected')) else '{}'::text[] end;
      corr := array(select o->>'id' from jsonb_array_elements(q->'options') o where (o->>'correct')::boolean);
      v_answered := cardinality(sel) > 0;
      v_ok := v_answered and sel <@ corr and corr <@ sel;
    end if;
    v_pts := case when v_ok then (q->>'points')::numeric else 0 end;
    insert into student_answers (attempt_id, question_id, answer, is_answered, is_correct, points_awarded)
    values (p_attempt, (q->>'id')::uuid, coalesce(ans, '{}'::jsonb), v_answered, v_ok, v_pts)
    on conflict (attempt_id, question_id) do update
      set is_answered = excluded.is_answered, is_correct = excluded.is_correct, points_awarded = excluded.points_awarded;
    v_total := v_total + v_pts; v_max := v_max + (q->>'points')::numeric;
  end loop;
  v_pct := case when v_max > 0 then round(v_total / v_max * 100, 2) else 0 end;
  update attempts set score = v_total, max_score = v_max, percent = v_pct,
         passed = v_pct >= (snap->>'passingGrade')::numeric
   where id = p_attempt;
end $$;

create function public.finalize_attempt(p_attempt uuid, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update attempts set status = 'submitted', auto_submitted = p_auto,
         submitted_at = case when p_auto then least(now(), deadline_at) else now() end
   where id = p_attempt and status = 'in_progress';
  if found then perform public.grade_attempt(p_attempt); end if;
end $$;

create function public.finalize_expired_for_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  for r in select id from attempts where user_id = p_user and status = 'in_progress' and deadline_at <= now() loop
    perform public.finalize_attempt(r, true);
  end loop;
end $$;

-- ───────────────────────── Examinations ─────────────────────────
create function public.save_exam(p_exam_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); v_id uuid; v_status text; q jsonb; o jsonb; pr jsonb; qi int := 0; i int; v_qid uuid;
        n_correct int; n_opts int; qtype text;
begin
  if length(btrim(coalesce(p->>'title', ''))) = 0 then raise exception 'The examination needs a title'; end if;
  if p_exam_id is null then
    insert into exams (owner_id, title, description, duration_minutes, passing_grade, randomize_options, free_navigation)
    values (uid, btrim(p->>'title'), coalesce(p->>'description', ''), coalesce((p->>'durationMinutes')::int, 60),
            coalesce((p->>'passingGrade')::numeric, 50), coalesce((p->>'randomizeOptions')::boolean, true),
            coalesce((p->>'freeNavigation')::boolean, true))
    returning id, status into v_id, v_status;
  else
    select id, status into v_id, v_status from exams where id = p_exam_id and owner_id = uid for update;
    if not found then raise exception 'Examination not found'; end if;
    update exams set title = btrim(p->>'title'), description = coalesce(p->>'description', ''),
           duration_minutes = coalesce((p->>'durationMinutes')::int, 60), passing_grade = coalesce((p->>'passingGrade')::numeric, 50),
           randomize_options = coalesce((p->>'randomizeOptions')::boolean, true),
           free_navigation = coalesce((p->>'freeNavigation')::boolean, true), updated_at = now()
     where id = v_id;
    delete from questions where exam_id = v_id;
  end if;

  for q in select * from jsonb_array_elements(coalesce(p->'questions', '[]'::jsonb)) loop
    qi := qi + 1; v_qid := gen_random_uuid(); qtype := q->>'type';
    if qtype not in ('single_choice', 'multiple_choice', 'matching') then raise exception 'Question %: unsupported question type', qi; end if;
    if length(btrim(coalesce(q->>'text', ''))) = 0 then raise exception 'Question %: the question text is empty', qi; end if;
    insert into questions (id, exam_id, position, type, text, points)
    values (v_qid, v_id, qi, qtype, btrim(q->>'text'), coalesce((q->>'points')::numeric, 1));
    if qtype = 'matching' then
      if jsonb_array_length(coalesce(q->'pairs', '[]'::jsonb)) < 2 then raise exception 'Question %: a matching question needs at least 2 pairs', qi; end if;
      i := 0;
      for pr in select * from jsonb_array_elements(q->'pairs') loop
        i := i + 1;
        insert into matching_pairs (question_id, position, left_text, right_text) values (v_qid, i, btrim(pr->>'left'), btrim(pr->>'right'));
      end loop;
    else
      n_opts := jsonb_array_length(coalesce(q->'options', '[]'::jsonb)); n_correct := 0; i := 0;
      if n_opts < 2 then raise exception 'Question %: at least 2 answer options are required', qi; end if;
      for o in select * from jsonb_array_elements(q->'options') loop
        i := i + 1;
        if coalesce((o->>'correct')::boolean, false) then n_correct := n_correct + 1; end if;
        insert into answer_options (question_id, position, text, is_correct)
        values (v_qid, i, btrim(o->>'text'), coalesce((o->>'correct')::boolean, false));
      end loop;
      if qtype = 'single_choice' and n_correct <> 1 then raise exception 'Question %: a single-choice question needs exactly one correct answer', qi; end if;
      if qtype = 'multiple_choice' and n_correct < 1 then raise exception 'Question %: mark at least one correct answer', qi; end if;
    end if;
  end loop;
  if v_status = 'published' and qi = 0 then raise exception 'A published examination must contain at least one question'; end if;
  return v_id;
end $$;

create function public.set_exam_status(p_exam uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); n int;
begin
  if p_status not in ('draft', 'published', 'archived') then raise exception 'Invalid status'; end if;
  perform 1 from exams where id = p_exam and owner_id = uid;
  if not found then raise exception 'Examination not found'; end if;
  select count(*) into n from questions where exam_id = p_exam;
  if p_status = 'published' and n = 0 then raise exception 'Add at least one question before publishing'; end if;
  if p_status = 'draft' and exists (select 1 from assignments where exam_id = p_exam) then
    raise exception 'This examination is already assigned to a classroom. Archive it instead of moving it back to draft.';
  end if;
  update exams set status = p_status, updated_at = now() where id = p_exam;
end $$;

-- ───────────────────────── Classrooms ─────────────────────────
create function public.create_classroom(p_name text, p_description text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); v uuid;
begin
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Classroom name is required'; end if;
  insert into classrooms (owner_id, name, description, join_code)
  values (uid, btrim(p_name), coalesce(p_description, ''), public.gen_join_code()) returning id into v;
  return v;
end $$;

create function public.regenerate_join_code(p_classroom uuid) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); c text;
begin
  c := public.gen_join_code();
  update classrooms set join_code = c where id = p_classroom and owner_id = uid;
  if not found then raise exception 'Classroom not found'; end if;
  return c;
end $$;

create function public.join_classroom(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); c classrooms%rowtype; nm text;
begin
  select * into c from classrooms where join_code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Invalid joining code'; end if;
  if c.owner_id = uid then raise exception 'You created this classroom'; end if;
  if exists (select 1 from classroom_members where classroom_id = c.id and user_id = uid) then return c.id; end if;
  if c.archived or not c.enrollment_open then raise exception 'Enrollment for this classroom is closed'; end if;
  insert into classroom_members (classroom_id, user_id) values (c.id, uid) on conflict do nothing;
  select coalesce(nullif(full_name, ''), email, 'A user') into nm from profiles where id = uid;
  perform public.notify_user(c.owner_id, 'member_joined', 'New member in ' || c.name, nm || ' joined the classroom.', '/classrooms/' || c.id);
  return c.id;
end $$;

create function public.new_announcement_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  select name into cname from classrooms where id = new.classroom_id;
  insert into notifications (user_id, type, title, body, link)
  select m.user_id, 'announcement', 'New announcement in ' || cname, new.title, '/classrooms/' || new.classroom_id
  from classroom_members m where m.classroom_id = new.classroom_id;
  return new;
end $$;
create trigger announcements_notify after insert on public.announcements
  for each row execute function public.new_announcement_notify();

-- ───────────────────────── Assignments ─────────────────────────
create function public.assign_exam(p_classroom uuid, p_exam uuid, p_starts timestamptz, p_closes timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); ex exams%rowtype; cl classrooms%rowtype; snap jsonb; h text; ver uuid; v_closes timestamptz; v_id uuid;
begin
  select * into cl from classrooms where id = p_classroom and owner_id = uid;
  if not found then raise exception 'Classroom not found'; end if;
  select * into ex from exams where id = p_exam and owner_id = uid;
  if not found then raise exception 'Examination not found'; end if;
  if cl.archived then raise exception 'This classroom is archived'; end if;
  if ex.status <> 'published' then raise exception 'Only published examinations can be assigned'; end if;
  if p_starts is null then raise exception 'Choose a start date and time'; end if;
  v_closes := coalesce(p_closes, p_starts + make_interval(mins => ex.duration_minutes));
  if v_closes <= p_starts then raise exception 'The window must end after it starts'; end if;
  if v_closes <= now() then raise exception 'The window must end in the future'; end if;

  snap := public.build_exam_snapshot(p_exam);
  h := md5(snap::text);
  select id into ver from exam_versions where exam_id = p_exam and content_hash = h;
  if ver is null then
    insert into exam_versions (exam_id, version_number, content_hash, snapshot)
    values (p_exam, coalesce((select max(version_number) from exam_versions where exam_id = p_exam), 0) + 1, h, snap)
    returning id into ver;
  end if;
  insert into assignments (classroom_id, exam_id, exam_version_id, starts_at, closes_at, created_by)
  values (p_classroom, p_exam, ver, p_starts, v_closes, uid) returning id into v_id;

  insert into notifications (user_id, type, title, body, link)
  select m.user_id, 'assignment', 'New examination: ' || ex.title,
         cl.name || ' — opens ' || to_char(p_starts at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', '/classrooms/' || p_classroom
  from classroom_members m where m.classroom_id = p_classroom;
  return v_id;
end $$;

create function public.update_assignment_schedule(p_assignment uuid, p_starts timestamptz, p_closes timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_auth();
  if not public.owns_assignment(p_assignment) then raise exception 'Assignment not found'; end if;
  if p_closes <= p_starts then raise exception 'The window must end after it starts'; end if;
  update assignments set starts_at = p_starts, closes_at = p_closes where id = p_assignment;
end $$;

-- ───────────────────────── Taking an examination ─────────────────────────
create function public.start_attempt(p_assignment uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); a assignments%rowtype; snap jsonb; used int; granted int; cur uuid; dur int; dl timestamptz; shuf jsonb := '{}'::jsonb;
begin
  select * into a from assignments where id = p_assignment;
  if not found or not public.is_classroom_member(a.classroom_id) then raise exception 'Examination not found'; end if;
  perform pg_advisory_xact_lock(hashtext(p_assignment::text || uid::text));
  perform public.finalize_expired_for_user(uid);
  select id into cur from attempts where assignment_id = p_assignment and user_id = uid and status = 'in_progress';
  if cur is not null then return cur; end if;

  select v.snapshot into snap from exam_versions v where v.id = a.exam_version_id;
  select count(*) into used from attempts where assignment_id = p_assignment and user_id = uid;
  select count(*) into granted from attempt_grants where assignment_id = p_assignment and user_id = uid;
  if used >= 1 + granted then raise exception 'You have no attempts remaining for this examination'; end if;

  dur := (snap->>'durationMinutes')::int;
  if granted = 0 then
    if now() < a.starts_at then raise exception 'This examination has not started yet'; end if;
    if now() > a.closes_at then raise exception 'The examination window has closed'; end if;
    dl := least(now() + make_interval(mins => dur), a.closes_at);
  else
    dl := now() + make_interval(mins => dur);   -- granted attempts ignore the original window
  end if;

  if coalesce((snap->>'randomizeOptions')::boolean, false) then
    select coalesce(jsonb_object_agg(q->>'id',
             case when q->>'type' = 'matching'
                  then (select jsonb_agg(p->>'id' order by random()) from jsonb_array_elements(q->'pairs') p)
                  else (select jsonb_agg(o->>'id' order by random()) from jsonb_array_elements(q->'options') o) end), '{}'::jsonb)
      into shuf from jsonb_array_elements(snap->'questions') q;
  end if;

  insert into attempts (assignment_id, user_id, attempt_number, deadline_at, shuffle)
  values (p_assignment, uid, used + 1, dl, shuf) returning id into cur;
  return cur;
end $$;

-- Returns the exam WITHOUT correct answers. Matching right-hand items get opaque per-attempt tokens
-- (md5 of a secret salt + pair id), so ids never reveal the right pairing.
create function public.get_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); att attempts%rowtype; snap jsonb; base jsonb; qs jsonb; shuf jsonb; ans jsonb;
begin
  select * into att from attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'Attempt not found'; end if;
  if att.status = 'in_progress' and now() > att.deadline_at then
    perform public.finalize_attempt(p_attempt, true);
    select * into att from attempts where id = p_attempt;
  end if;
  base := jsonb_build_object('attempt', jsonb_build_object('id', att.id, 'assignment_id', att.assignment_id, 'status', att.status,
            'started_at', att.started_at, 'deadline_at', att.deadline_at, 'attempt_number', att.attempt_number), 'server_now', now());
  if att.status <> 'in_progress' then return base; end if;

  select v.snapshot into snap from assignments a join exam_versions v on v.id = a.exam_version_id where a.id = att.assignment_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.q->>'id', 'type', x.q->>'type', 'text', x.q->>'text', 'points', x.q->'points',
      'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')), '[]'::jsonb) from jsonb_array_elements(x.q->'options') o),
      'left',    (select coalesce(jsonb_agg(jsonb_build_object('id', p->>'id', 'text', p->>'left')), '[]'::jsonb) from jsonb_array_elements(x.q->'pairs') p),
      'right',   (select coalesce(jsonb_agg(jsonb_build_object('id', md5(att.salt::text || (p->>'id')), 'text', p->>'right')), '[]'::jsonb) from jsonb_array_elements(x.q->'pairs') p)
    ) order by x.ord), '[]'::jsonb)
    into qs from jsonb_array_elements(snap->'questions') with ordinality as x(q, ord);

  select coalesce(jsonb_object_agg(x.q->>'id',
           case when x.q->>'type' = 'matching'
                then (select coalesce(jsonb_agg(md5(att.salt::text || e.v) order by e.i), '[]'::jsonb) from jsonb_array_elements_text(att.shuffle->(x.q->>'id')) with ordinality as e(v, i))
                else att.shuffle->(x.q->>'id') end), '{}'::jsonb)
    into shuf from jsonb_array_elements(snap->'questions') as x(q) where att.shuffle->(x.q->>'id') is not null;

  select coalesce(jsonb_object_agg(question_id::text, answer), '{}'::jsonb) into ans from student_answers where attempt_id = p_attempt;
  return base || jsonb_build_object(
    'exam', jsonb_build_object('title', snap->>'title', 'description', snap->>'description', 'durationMinutes', snap->'durationMinutes',
                               'freeNavigation', coalesce(snap->'freeNavigation', 'true'::jsonb), 'questions', qs),
    'shuffle', shuf, 'answers', ans);
end $$;

create function public.save_answer(p_attempt uuid, p_question uuid, p_answer jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); att attempts%rowtype; snap jsonb;
begin
  select * into att from attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'Attempt not found'; end if;
  if att.status = 'submitted' then return jsonb_build_object('status', 'submitted'); end if;
  if now() > att.deadline_at then
    perform public.finalize_attempt(p_attempt, true);
    return jsonb_build_object('status', 'expired');
  end if;
  select v.snapshot into snap from assignments a join exam_versions v on v.id = a.exam_version_id where a.id = att.assignment_id;
  if not jsonb_path_exists(snap, '$.questions[*] ? (@.id == $qid)', jsonb_build_object('qid', p_question::text)) then
    raise exception 'Unknown question';
  end if;
  insert into student_answers (attempt_id, question_id, answer) values (p_attempt, p_question, coalesce(p_answer, '{}'::jsonb))
  on conflict (attempt_id, question_id) do update set answer = excluded.answer, updated_at = now();
  return jsonb_build_object('status', 'saved', 'server_now', now(), 'deadline_at', att.deadline_at);
end $$;

-- Idempotent. Optionally carries any answers not yet synced (accepted up to 20 s past the deadline for network latency).
create function public.submit_attempt(p_attempt uuid, p_answers jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); att attempts%rowtype; snap jsonb; k text; v jsonb;
begin
  select * into att from attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'Attempt not found'; end if;
  if att.status = 'submitted' then return jsonb_build_object('status', 'submitted'); end if;
  if p_answers is not null and jsonb_typeof(p_answers) = 'object' and now() <= att.deadline_at + interval '20 seconds' then
    select s.snapshot into snap from (select v2.snapshot from assignments a join exam_versions v2 on v2.id = a.exam_version_id where a.id = att.assignment_id) s;
    for k, v in select key, value from jsonb_each(p_answers) loop
      if k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and jsonb_path_exists(snap, '$.questions[*] ? (@.id == $qid)', jsonb_build_object('qid', k)) then
        insert into student_answers (attempt_id, question_id, answer) values (p_attempt, k::uuid, v)
        on conflict (attempt_id, question_id) do update set answer = excluded.answer, updated_at = now();
      end if;
    end loop;
  end if;
  perform public.finalize_attempt(p_attempt, now() > att.deadline_at);
  return jsonb_build_object('status', 'submitted');
end $$;

-- ───────────────────────── Student views (grades only after release) ─────────────────────────
create function public.student_assignments() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth();
begin
  perform public.finalize_expired_for_user(uid);
  return coalesce((select jsonb_agg(s.r order by (s.r->>'starts_at') desc) from (
    select jsonb_build_object(
      'assignment_id', a.id, 'classroom_id', c.id, 'classroom_name', c.name, 'classroom_archived', c.archived,
      'exam_title', v.snapshot->>'title', 'description', v.snapshot->>'description',
      'duration_minutes', (v.snapshot->>'durationMinutes')::int, 'question_count', jsonb_array_length(v.snapshot->'questions'),
      'starts_at', a.starts_at, 'closes_at', a.closes_at, 'results_released_at', a.results_released_at,
      'attempts_used', (select count(*) from attempts t where t.assignment_id = a.id and t.user_id = uid),
      'attempts_allowed', 1 + (select count(*) from attempt_grants g where g.assignment_id = a.id and g.user_id = uid),
      'submitted_count', (select count(*) from attempts t where t.assignment_id = a.id and t.user_id = uid and t.status = 'submitted'),
      'in_progress_attempt_id', (select t.id from attempts t where t.assignment_id = a.id and t.user_id = uid and t.status = 'in_progress' limit 1),
      'last_submitted_at', (select max(t.submitted_at) from attempts t where t.assignment_id = a.id and t.user_id = uid),
      'result', case when a.results_released_at is not null then
         (select jsonb_build_object('score', t.score, 'max_score', t.max_score, 'percent', t.percent, 'passed', t.passed,
                                    'time_spent_seconds', extract(epoch from (t.submitted_at - t.started_at)))
            from attempts t where t.assignment_id = a.id and t.user_id = uid and t.status = 'submitted'
            order by t.percent desc, t.attempt_number desc limit 1) end
    ) as r
    from assignments a
    join classrooms c on c.id = a.classroom_id
    join exam_versions v on v.id = a.exam_version_id
    join classroom_members m on m.classroom_id = c.id and m.user_id = uid
  ) s), '[]'::jsonb);
end $$;

create function public.attempt_detail(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare att attempts%rowtype; snap jsonb; q jsonb; sa student_answers%rowtype; res jsonb := '[]'::jsonb; opts jsonb; prs jsonb; o jsonb; p jsonb; chosen text;
begin
  select * into att from attempts where id = p_attempt;
  select v.snapshot into snap from assignments a join exam_versions v on v.id = a.exam_version_id where a.id = att.assignment_id;
  for q in select * from jsonb_array_elements(snap->'questions') loop
    select * into sa from student_answers where attempt_id = p_attempt and question_id = (q->>'id')::uuid;
    opts := '[]'::jsonb; prs := '[]'::jsonb;
    if q->>'type' = 'matching' then
      for p in select * from jsonb_array_elements(q->'pairs') loop
        chosen := null;
        select p2->>'right' into chosen from jsonb_array_elements(q->'pairs') p2
         where md5(att.salt::text || (p2->>'id')) = (sa.answer->'matches'->>(p->>'id'));
        prs := prs || jsonb_build_array(jsonb_build_object('left', p->>'left', 'right', p->>'right', 'chosen', chosen));
      end loop;
    else
      for o in select * from jsonb_array_elements(q->'options') loop
        opts := opts || jsonb_build_array(jsonb_build_object('text', o->>'text', 'correct', (o->>'correct')::boolean,
                  'selected', coalesce(sa.answer->'selected', '[]'::jsonb) @> to_jsonb(o->>'id')));
      end loop;
    end if;
    res := res || jsonb_build_array(jsonb_build_object('id', q->>'id', 'type', q->>'type', 'text', q->>'text',
             'points', (q->>'points')::numeric, 'awarded', coalesce(sa.points_awarded, 0), 'is_correct', coalesce(sa.is_correct, false),
             'is_answered', coalesce(sa.is_answered, false), 'options', opts, 'pairs', prs));
  end loop;
  return jsonb_build_object('attempt', jsonb_build_object('id', att.id, 'attempt_number', att.attempt_number, 'score', att.score,
           'max_score', att.max_score, 'percent', att.percent, 'passed', att.passed, 'started_at', att.started_at,
           'submitted_at', att.submitted_at, 'auto_submitted', att.auto_submitted), 'passing_grade', snap->'passingGrade', 'questions', res);
end $$;

-- Teacher: any attempt in their classroom. Student: own submitted attempts, only after results were released.
create function public.get_attempt_detail(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); att attempts%rowtype;
begin
  select * into att from attempts where id = p_attempt;
  if not found then raise exception 'Attempt not found'; end if;
  if public.owns_assignment(att.assignment_id) then
    return public.attempt_detail(p_attempt);
  elsif att.user_id = uid and att.status = 'submitted'
        and exists (select 1 from assignments where id = att.assignment_id and results_released_at is not null) then
    return public.attempt_detail(p_attempt);
  end if;
  raise exception 'Results are not available yet';
end $$;

create function public.get_my_result(p_assignment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); a assignments%rowtype; r uuid; res jsonb := '[]'::jsonb; title text; cname text;
begin
  select * into a from assignments where id = p_assignment;
  if not found or not public.is_classroom_member(a.classroom_id) then raise exception 'Examination not found'; end if;
  if a.results_released_at is null then raise exception 'Results have not been released yet'; end if;
  select v.snapshot->>'title' into title from exam_versions v where v.id = a.exam_version_id;
  select name into cname from classrooms where id = a.classroom_id;
  for r in select id from attempts where assignment_id = p_assignment and user_id = uid and status = 'submitted' order by attempt_number loop
    res := res || jsonb_build_array(public.attempt_detail(r));
  end loop;
  return jsonb_build_object('title', title, 'classroom', cname, 'released_at', a.results_released_at, 'attempts', res);
end $$;

-- ───────────────────────── Teacher actions ─────────────────────────
create function public.finalize_expired(p_assignment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  perform public.require_auth();
  if not public.owns_assignment(p_assignment) then raise exception 'Assignment not found'; end if;
  for r in select id from attempts where assignment_id = p_assignment and status = 'in_progress' and deadline_at <= now() loop
    perform public.finalize_attempt(r, true);
  end loop;
end $$;

create function public.release_results(p_assignment uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); a assignments%rowtype; v_total int; v_sub int; v_started int; ttl text;
begin
  select * into a from assignments where id = p_assignment;
  if not found or not public.owns_assignment(p_assignment) then raise exception 'Assignment not found'; end if;
  perform public.finalize_expired(p_assignment);
  select count(*) into v_total from classroom_members where classroom_id = a.classroom_id;
  select count(distinct t.user_id) into v_sub from attempts t join classroom_members m on m.user_id = t.user_id and m.classroom_id = a.classroom_id
   where t.assignment_id = p_assignment and t.status = 'submitted';
  select count(distinct t.user_id) into v_started from attempts t join classroom_members m on m.user_id = t.user_id and m.classroom_id = a.classroom_id
   where t.assignment_id = p_assignment;
  if a.results_released_at is null then
    if v_sub < v_total and not p_force then
      return jsonb_build_object('released', false, 'total', v_total, 'submitted', v_sub, 'in_progress', v_started - v_sub, 'not_started', v_total - v_started);
    end if;
    update assignments set results_released_at = now() where id = p_assignment;
    insert into result_releases (assignment_id, released_by, forced, submitted_count, not_submitted_count)
    values (p_assignment, uid, v_sub < v_total, v_sub, v_total - v_sub);
    select v.snapshot->>'title' into ttl from exam_versions v where v.id = a.exam_version_id;
    insert into notifications (user_id, type, title, body, link)
    select m.user_id, 'results', 'Results released: ' || ttl, 'You can now view your result.', '/results/' || p_assignment
    from classroom_members m where m.classroom_id = a.classroom_id;
  end if;
  return jsonb_build_object('released', true, 'total', v_total, 'submitted', v_sub, 'in_progress', v_started - v_sub, 'not_started', v_total - v_started);
end $$;

-- Never destructive: adds an allowance; earlier attempts and grades stay untouched.
create function public.grant_attempt(p_assignment uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth(); a assignments%rowtype; ttl text;
begin
  select * into a from assignments where id = p_assignment;
  if not found or not public.owns_assignment(p_assignment) then raise exception 'Assignment not found'; end if;
  if not exists (select 1 from classroom_members where classroom_id = a.classroom_id and user_id = p_user) then
    raise exception 'That user is not a member of this classroom';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Please give a reason for the additional attempt'; end if;
  insert into attempt_grants (assignment_id, user_id, granted_by, reason) values (p_assignment, p_user, uid, btrim(p_reason));
  select v.snapshot->>'title' into ttl from exam_versions v where v.id = a.exam_version_id;
  perform public.notify_user(p_user, 'attempt_granted', 'Additional attempt granted: ' || ttl, btrim(p_reason), '/take/' || p_assignment);
end $$;

-- ───────────────────────── Notifications helpers ─────────────────────────
create function public.mark_all_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- Creates one reminder per upcoming assignment (starting within 24 h) in classrooms you belong to. Safe to call repeatedly.
create function public.generate_my_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_auth();
begin
  insert into notifications (user_id, type, title, body, link, dedupe_key)
  select uid, 'reminder', 'Upcoming examination: ' || v.snapshot->>'title',
         c.name || ' — starts ' || to_char(a.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', '/take/' || a.id, 'reminder:' || a.id
  from assignments a join classrooms c on c.id = a.classroom_id
  join exam_versions v on v.id = a.exam_version_id
  join classroom_members m on m.classroom_id = c.id and m.user_id = uid
  where a.starts_at > now() and a.starts_at <= now() + interval '24 hours'
  on conflict (user_id, dedupe_key) do nothing;
end $$;

-- ───────────────────────── Lock down internal functions ─────────────────────────
revoke execute on all functions in schema public from public, anon;
revoke execute on function public.notify_user(uuid, text, text, text, text, text),
                           public.gen_join_code(), public.build_exam_snapshot(uuid), public.grade_attempt(uuid),
                           public.finalize_attempt(uuid, boolean), public.finalize_expired_for_user(uuid),
                           public.attempt_detail(uuid), public.handle_new_user(), public.sync_profile_email(),
                           public.new_announcement_notify()
  from authenticated;
