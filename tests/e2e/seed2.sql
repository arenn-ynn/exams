create or replace function pg_temp.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, false) $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$ declare att uuid; a uuid; begin
 select id into a from assignments where exam_id=(select id from exams where title='Algebra basics') and classroom_id=(select id from classrooms where name like 'Class 10A%');
 att := start_attempt(a);
 perform submit_attempt(att, '{}'::jsonb);
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select release_results(id, true) from assignments where exam_id=(select id from exams where title='Algebra basics') and classroom_id=(select id from classrooms where name like 'Class 10A%');
