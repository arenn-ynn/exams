-- End-to-end database test: RLS, grading, timer, release workflow, extra attempts, versioning.
create table public.ctx (k text primary key, v text);
grant all on public.ctx to authenticated;

create function public.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
  execute 'set role authenticated';
end $$;
grant execute on function public.as_user(uuid) to public;
create function public.as_admin() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', false); end $$;
grant execute on function public.as_admin() to public;

create function public.expect_fail(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'PASS  % (blocked: %)', p_label, sqlerrm; return; end;
  raise exception 'FAIL  % — statement succeeded but should have been blocked', p_label;
end $$;
grant execute on function public.expect_fail(text, text) to public;

create function public.check_eq(p_label text, p_actual text, p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then raise exception 'FAIL  % — expected %, got %', p_label, p_expected, p_actual; end if;
  raise notice 'PASS  %', p_label;
end $$;

-- users
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1', 'teacher@example.com', '{"full_name":"Tina Teacher"}'),
 ('00000000-0000-0000-0000-0000000000b2', 'alice@example.com',   '{"full_name":"Alice"}'),
 ('00000000-0000-0000-0000-0000000000b3', 'bob@example.com',     '{"full_name":"Bob"}'),
 ('00000000-0000-0000-0000-0000000000b4', 'carol@example.com',   '{"full_name":"Carol"}');
select public.check_eq('profile trigger created profiles', (select count(*)::text from profiles), '4');
select public.check_eq('preferences trigger', (select count(*)::text from user_preferences), '4');

-- ── Teacher builds an exam ──
select public.as_user('00000000-0000-0000-0000-0000000000a1');
insert into ctx select 'exam', public.save_exam(null, $j$
{"title":"Maths 1","description":"d","durationMinutes":30,"passingGrade":50,"randomizeOptions":true,"questions":[
 {"type":"single_choice","text":"2+2?","points":2,"options":[{"text":"3","correct":false},{"text":"4","correct":true},{"text":"5","correct":false}]},
 {"type":"multiple_choice","text":"Primes?","points":3,"options":[{"text":"2","correct":true},{"text":"4","correct":false},{"text":"7","correct":true}]},
 {"type":"matching","text":"Capitals","points":5,"pairs":[{"left":"France","right":"Paris"},{"left":"Italy","right":"Rome"},{"left":"Spain","right":"Madrid"}]}
]}$j$::jsonb)::text;
select public.expect_fail($$select public.save_exam(null, '{"title":"x","questions":[{"type":"single_choice","text":"q","points":1,"options":[{"text":"a","correct":true},{"text":"b","correct":true}]}]}'::jsonb)$$, 'single choice with 2 correct answers is rejected');
select public.set_exam_status((select v::uuid from ctx where k='exam'), 'published');
insert into ctx select 'class10a', public.create_classroom('Class 10A', 'maths')::text;
insert into ctx select 'class10b', public.create_classroom('Class 10B')::text;
select public.check_eq('join code is 8 chars', (select length(join_code)::text from classrooms where id = (select v::uuid from ctx where k='class10a')), '8');
insert into ctx select 'code', join_code from classrooms where id = (select v::uuid from ctx where k='class10a');

-- ── Students join (once) ──
select public.as_user('00000000-0000-0000-0000-0000000000b2'); select public.join_classroom(lower((select v from ctx where k='code')));
select public.join_classroom((select v from ctx where k='code'));  -- duplicate join is a no-op
select public.as_user('00000000-0000-0000-0000-0000000000b3'); select public.join_classroom((select v from ctx where k='code'));
select public.as_user('00000000-0000-0000-0000-0000000000b4'); select public.join_classroom((select v from ctx where k='code'));
select public.as_admin();
select public.check_eq('no duplicate membership', (select count(*)::text from classroom_members), '3');
select public.check_eq('owner notified of joins', (select count(*)::text from notifications where type='member_joined'), '3');
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.expect_fail($$select public.join_classroom((select v from ctx where k='code'))$$, 'owner cannot join own classroom');
update classrooms set enrollment_open = false where id = (select v::uuid from ctx where k='class10a');
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.expect_fail($$select public.join_classroom('ZZZZZZZZ')$$, 'invalid code rejected');
update classrooms set enrollment_open = true where id = (select v::uuid from ctx where k='class10a');

-- ── Assign the same exam to two classrooms; edit → new version ──
insert into ctx select 'asg_a', public.assign_exam((select v::uuid from ctx where k='class10a'), (select v::uuid from ctx where k='exam'), now() - interval '1 minute', now() + interval '1 hour')::text;
insert into ctx select 'asg_b', public.assign_exam((select v::uuid from ctx where k='class10b'), (select v::uuid from ctx where k='exam'), now() + interval '2 days')::text;
select public.as_admin();
select public.check_eq('same exam, 2 assignments, 1 shared version', (select count(distinct exam_version_id)::text from assignments), '1');
select public.check_eq('members notified of assignment', (select count(*)::text from notifications where type='assignment'), '3');

-- ── Students must not see exam content or grades directly (RLS) ──
select public.as_user('00000000-0000-0000-0000-0000000000b2');
select public.check_eq('student cannot read exams', (select count(*)::text from exams), '0');
select public.check_eq('student cannot read exam_versions (answers)', (select count(*)::text from exam_versions), '0');
select public.check_eq('student cannot read questions', (select count(*)::text from questions), '0');
select public.check_eq('student sees own assignment only', (select jsonb_array_length(public.student_assignments())::text), '1');
select public.expect_fail($$update attempts set percent = 100$$, 'student cannot write attempts');
select public.expect_fail($$insert into classroom_members values ((select v::uuid from ctx where k='class10b'), '00000000-0000-0000-0000-0000000000b2')$$, 'cannot self-insert membership');
select public.expect_fail($$select public.start_attempt((select v::uuid from ctx where k='asg_b'))$$, 'cannot start exam of a classroom they are not in');

-- ── Alice takes the exam ──
insert into ctx select 'att_alice', public.start_attempt((select v::uuid from ctx where k='asg_a'))::text;
select public.check_eq('start_attempt is idempotent while in progress', public.start_attempt((select v::uuid from ctx where k='asg_a'))::text, (select v from ctx where k='att_alice'));
insert into ctx select 'payload', public.get_attempt((select v::uuid from ctx where k='att_alice'))::text;
select public.check_eq('attempt payload has 3 questions', (select jsonb_array_length((v::jsonb)->'exam'->'questions')::text from ctx where k='payload'), '3');
select public.check_eq('attempt payload leaks no correct flags', (select (position('correct' in v) > 0)::text from ctx where k='payload'), 'false');

select public.as_admin();
-- Build correct answers from the snapshot (admin only: this is what a cheating student must NOT be able to do)
create temp table keyed as
 select q->>'id' as qid, q->>'type' as qtype, q,
        (select salt from attempts where id = (select v::uuid from ctx where k='att_alice')) as salt
 from exam_versions v, jsonb_array_elements(v.snapshot->'questions') q;
grant all on keyed to authenticated;
-- single: pick the right option ids (admin-computed), multiple likewise, matching via opaque tokens from the student's own payload
select public.as_admin();
create temp table alice_ans as
 select qid, case qtype
   when 'matching' then jsonb_build_object('matches', (select jsonb_object_agg(p->>'id', md5(salt::text || (p->>'id'))) from jsonb_array_elements(q->'pairs') p))
   else jsonb_build_object('selected', (select jsonb_agg(o->>'id') from jsonb_array_elements(q->'options') o where (o->>'correct')::boolean)) end as ans
 from keyed;
grant all on alice_ans to authenticated;
select public.as_user('00000000-0000-0000-0000-0000000000b2');
select public.check_eq('save_answer returns saved', (select public.save_answer((select v::uuid from ctx where k='att_alice'), (select qid::uuid from alice_ans limit 1), (select ans from alice_ans limit 1))->>'status'), 'saved');
select public.expect_fail($$select public.save_answer((select v::uuid from ctx where k='att_alice'), gen_random_uuid(), '{}'::jsonb)$$, 'unknown question id rejected');
-- progress survives reload
select public.check_eq('saved answers are restored by get_attempt', (select jsonb_object_keys(public.get_attempt((select v::uuid from ctx where k='att_alice'))->'answers') limit 1), (select qid from alice_ans limit 1));
-- submit with remaining (unsynced) answers in one call
select public.check_eq('submit_attempt', (select public.submit_attempt((select v::uuid from ctx where k='att_alice'), (select jsonb_object_agg(qid, ans) from alice_ans))->>'status'), 'submitted');
select public.check_eq('duplicate submit is idempotent', (select public.submit_attempt((select v::uuid from ctx where k='att_alice'))->>'status'), 'submitted');
select public.expect_fail($$select public.start_attempt((select v::uuid from ctx where k='asg_a'))$$, 'second attempt without grant is refused');
select public.check_eq('student cannot see grade before release', (select count(*)::text from attempts), '0');
select public.expect_fail($$select public.get_my_result((select v::uuid from ctx where k='asg_a'))$$, 'get_my_result blocked before release');
select public.expect_fail($$select public.get_attempt_detail((select v::uuid from ctx where k='att_alice'))$$, 'attempt detail blocked before release');
select public.check_eq('student_assignments hides result before release', (select (public.student_assignments()->0->'result')::text), 'null');

-- ── Bob answers partly wrong ──
select public.as_user('00000000-0000-0000-0000-0000000000b3');
insert into ctx select 'att_bob', public.start_attempt((select v::uuid from ctx where k='asg_a'))::text;
select public.expect_fail($$select public.get_attempt((select v::uuid from ctx where k='att_alice'))$$, 'cannot read another student''s attempt');
select public.as_admin();
create temp table bob_ans as
 select qid, case qtype
   when 'single_choice' then jsonb_build_object('selected', (select jsonb_agg(o->>'id') from jsonb_array_elements(q->'options') o where not (o->>'correct')::boolean limit 1))  -- wrong
   when 'multiple_choice' then jsonb_build_object('selected', (select jsonb_agg(o->>'id') from jsonb_array_elements(q->'options') o where (o->>'correct')::boolean))  -- right
   else jsonb_build_object('matches', '{}'::jsonb) end as ans
 from keyed;
grant all on bob_ans to authenticated;
select public.as_user('00000000-0000-0000-0000-0000000000b3');
select public.submit_attempt((select v::uuid from ctx where k='att_bob'), (select jsonb_object_agg(qid, ans) from bob_ans));

-- ── Teacher: results, release workflow ──
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.check_eq('alice scored 100%', (select percent::text from attempts where id = (select v::uuid from ctx where k='att_alice')), '100.00');
select public.check_eq('bob scored 3/10 = 30%', (select percent::text from attempts where id = (select v::uuid from ctx where k='att_bob')), '30.00');
select public.check_eq('bob failed (pass mark 50)', (select passed::text from attempts where id = (select v::uuid from ctx where k='att_bob')), 'false');
select public.check_eq('teacher sees unanswered flags', (select count(*)::text from student_answers where attempt_id = (select v::uuid from ctx where k='att_bob') and not is_answered), '1');
select public.check_eq('release warns when someone has not submitted', (select public.release_results((select v::uuid from ctx where k='asg_a'))->>'released'), 'false');
select public.check_eq('...and reports not_started=1', (select public.release_results((select v::uuid from ctx where k='asg_a'))->>'not_started'), '1');
select public.as_user('00000000-0000-0000-0000-0000000000b2');
select public.expect_fail($$select public.release_results((select v::uuid from ctx where k='asg_a'), true)$$, 'student cannot release results');
select public.expect_fail($$select public.grant_attempt((select v::uuid from ctx where k='asg_a'), '00000000-0000-0000-0000-0000000000b2', 'cheat')$$, 'student cannot grant attempts');
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.check_eq('forced release succeeds', (select public.release_results((select v::uuid from ctx where k='asg_a'), true)->>'released'), 'true');
select public.check_eq('release is recorded', (select forced::text || '/' || not_submitted_count from result_releases), 'true/1');

-- ── After release students see their own result with details ──
select public.as_user('00000000-0000-0000-0000-0000000000b3');
select public.check_eq('bob sees released grade', (select (public.student_assignments()->0->'result'->>'percent')), '30.00');
select public.check_eq('bob sees question details', (select jsonb_array_length(public.get_my_result((select v::uuid from ctx where k='asg_a'))->'attempts'->0->'questions')::text), '3');
select public.expect_fail($$select public.get_attempt_detail((select v::uuid from ctx where k='att_alice'))$$, 'bob cannot open alice''s detail');

-- ── Additional attempt: preserved history ──
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.expect_fail($$select public.grant_attempt((select v::uuid from ctx where k='asg_a'), '00000000-0000-0000-0000-0000000000a1', 'x')$$, 'cannot grant to a non-member');
select public.expect_fail($$select public.grant_attempt((select v::uuid from ctx where k='asg_a'), '00000000-0000-0000-0000-0000000000b3', '  ')$$, 'reason is required');
select public.grant_attempt((select v::uuid from ctx where k='asg_a'), '00000000-0000-0000-0000-0000000000b3', 'Wi-Fi dropped');
select public.as_user('00000000-0000-0000-0000-0000000000b3');
select public.check_eq('attempts allowed becomes 2', (public.student_assignments()->0->>'attempts_allowed'), '2');
insert into ctx select 'att_bob2', public.start_attempt((select v::uuid from ctx where k='asg_a'))::text;
select public.as_admin();
select public.check_eq('previous attempt and grade preserved', (select count(*)::text from attempts where user_id='00000000-0000-0000-0000-0000000000b3' and status='submitted' and percent = 30), '1');
select public.check_eq('attempt numbers 1 and 2', (select string_agg(attempt_number::text, ',' order by attempt_number) from attempts where user_id='00000000-0000-0000-0000-0000000000b3'), '1,2');
select public.check_eq('student notified of grant', (select count(*)::text from notifications where type='attempt_granted'), '1');

-- ── Server-side timer: expired attempt is finalised by the server ──
update attempts set deadline_at = now() - interval '1 minute' where id = (select v::uuid from ctx where k='att_bob2');
select public.as_user('00000000-0000-0000-0000-0000000000b3');
select public.check_eq('save after deadline is refused', (select public.save_answer((select v::uuid from ctx where k='att_bob2'), (select qid::uuid from keyed limit 1), '{"selected":[]}'::jsonb)->>'status'), 'expired');
select public.as_admin();
select public.check_eq('expired attempt auto-submitted & graded', (select status || '/' || auto_submitted || '/' || (percent is not null) from attempts where id = (select v::uuid from ctx where k='att_bob2')), 'submitted/true/true');

-- ── Carol never started; window closed → cannot start late without a grant ──
update assignments set closes_at = now() - interval '1 second', starts_at = now() - interval '1 hour' where id = (select v::uuid from ctx where k='asg_a');
select public.as_user('00000000-0000-0000-0000-0000000000b4');
select public.expect_fail($$select public.start_attempt((select v::uuid from ctx where k='asg_a'))$$, 'cannot start after the window closed');
select public.as_user('00000000-0000-0000-0000-0000000000b2');
select public.expect_fail($$select public.start_attempt((select v::uuid from ctx where k='asg_b'))$$, 'cannot start exam of other classroom');

-- ── Versioning: edit exam after assignment → new snapshot; old assignment unchanged ──
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.save_exam((select v::uuid from ctx where k='exam'), '{"title":"Maths 1 v2","questions":[{"type":"single_choice","text":"New?","points":1,"options":[{"text":"a","correct":true},{"text":"b","correct":false}]}]}'::jsonb);
insert into ctx select 'asg_c', public.assign_exam((select v::uuid from ctx where k='class10b'), (select v::uuid from ctx where k='exam'), now() + interval '3 days')::text;
select public.as_admin();
select public.check_eq('two versions now exist', (select count(*)::text from exam_versions), '2');
select public.check_eq('old assignment still uses original title', (select v.snapshot->>'title' from assignments a join exam_versions v on v.id = a.exam_version_id where a.id = (select v::uuid from ctx where k='asg_a')), 'Maths 1');

-- ── Misc security ──
select public.as_user('00000000-0000-0000-0000-0000000000b2');
select public.expect_fail($$update classrooms set join_code = 'HACKED' where true$$, 'student cannot edit classroom');
select public.expect_fail($$insert into announcements (classroom_id, title, message) values ((select v::uuid from ctx where k='class10a'), 't', 'm')$$, 'student cannot post announcements');
select public.expect_fail($$update notifications set title = 'x'$$, 'notifications: only read_at is writable');
select public.as_user('00000000-0000-0000-0000-0000000000a1');
insert into announcements (classroom_id, title, message) values ((select v::uuid from ctx where k='class10a'), 'Exam Friday', 'Be on time');
select public.as_user('00000000-0000-0000-0000-0000000000b2');
select public.check_eq('student sees announcement', (select count(*)::text from announcements), '1');
select public.check_eq('student got announcement notification', (select count(*)::text from notifications where type='announcement'), '1');
select public.as_user('00000000-0000-0000-0000-0000000000b3');
select public.check_eq('students cannot see each other profiles', (select count(*)::text from profiles where id <> '00000000-0000-0000-0000-0000000000b3'), '1'); -- only the teacher
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.check_eq('teacher sees member profiles', (select count(*)::text from profiles), '4');
select public.expect_fail($$delete from exams where id = (select v::uuid from ctx where k='exam')$$, 'cannot delete an exam that has assignments');
-- ── Regression: reminders (generate_my_reminders used to fail with a json cast error because of `||` / `->>` precedence) ──
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.assign_exam((select v::uuid from ctx where k='class10a'), (select v::uuid from ctx where k='exam'), now() + interval '2 hours', now() + interval '6 hours');
select public.as_user('00000000-0000-0000-0000-0000000000b2');
select public.generate_my_reminders();
select public.check_eq('upcoming exam creates exactly one reminder', (select count(*)::text from notifications where type='reminder'), '1');
select public.check_eq('reminder title is readable text', (select left(title, 21) from notifications where type='reminder'), 'Upcoming examination:');
select public.generate_my_reminders();
select public.check_eq('reminders are de-duplicated', (select count(*)::text from notifications where type='reminder'), '1');
select public.as_admin();
select 'ALL DATABASE TESTS PASSED' as result;
