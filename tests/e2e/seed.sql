-- users
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1','teacher@example.test','{"full_name":"Teresa Teacherson-Longname the Third"}'),
 ('00000000-0000-0000-0000-0000000000b1','student1@example.test','{"full_name":"Sam Student"}'),
 ('00000000-0000-0000-0000-0000000000b2','student2@example.test','{"full_name":"Supercalifragilisticexpialidocious Averyveryveryverylonglastnamethatdoesnotbreak"}'),
 ('00000000-0000-0000-0000-0000000000b3','a.really.long.email.address.for.testing.layout@subdomain.example-university.test','{"full_name":"Zed"}');
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, false) $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
-- classrooms
select create_classroom('Class 10A — Advanced Placement Mathematics & Physics (Evening Section) very long name','A long description '||repeat('lorem ipsum dolor sit amet ',12));
select create_classroom('SupercalifragilisticexpialidocioussupercalifragilisticexpialidociousNoSpacesAtAll','');
select create_classroom('Class 10B','Short');

-- exams
select save_exam(null, jsonb_build_object('title','Algebra basics','description','Intro','durationMinutes',30,'passingGrade',50,'randomizeOptions',true,'freeNavigation',true,
 'questions', jsonb_build_array(
  jsonb_build_object('type','single_choice','text','What is 2+2?','points',1,'options',jsonb_build_array(jsonb_build_object('text','3','correct',false),jsonb_build_object('text','4','correct',true),jsonb_build_object('text','5','correct',false))),
  jsonb_build_object('type','multiple_choice','text','Select the prime numbers','points',2,'options',jsonb_build_array(jsonb_build_object('text','2','correct',true),jsonb_build_object('text','4','correct',false),jsonb_build_object('text','7','correct',true))),
  jsonb_build_object('type','matching','text','Match capitals','points',2,'pairs',jsonb_build_array(jsonb_build_object('left','France','right','Paris'),jsonb_build_object('left','Italy','right','Rome'),jsonb_build_object('left','Spain','right','Madrid')))
 )));
select save_exam(null, jsonb_build_object('title','Thisisaveryveryverylongexamtitlewithoutanyspacesatalltotestoverflowhandlingonnarrowphonescreens1234567890','description','x','durationMinutes',10,'passingGrade',50,
 'questions', jsonb_build_array(jsonb_build_object('type','single_choice','text',repeat('Averyveryverylongunbreakablequestiontext',6),'points',1,'options',jsonb_build_array(jsonb_build_object('text',repeat('LongOptionWithoutSpaces',8),'correct',true),jsonb_build_object('text','b','correct',false))))));
select save_exam(null, jsonb_build_object('title','Draft exam','questions','[]'::jsonb));
-- many questions exam (30)
select save_exam(null, jsonb_build_object('title','Big exam','durationMinutes',60,'passingGrade',50,'questions',
 (select jsonb_agg(jsonb_build_object('type','single_choice','text','Question number '||g,'points',1,'options',jsonb_build_array(jsonb_build_object('text','yes','correct',true),jsonb_build_object('text','no','correct',false)))) from generate_series(1,30) g)));
update exams set status='published' where title in ('Algebra basics','Big exam') or title like 'Thisis%';

-- memberships (students join by code)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select join_classroom(join_code) from classrooms where name like 'Class 10A%';
select join_classroom(join_code) from classrooms where name like 'Superc%';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select join_classroom(join_code) from classrooms where name like 'Class 10A%';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select join_classroom(join_code) from classrooms where name like 'Class 10A%';

-- assignments (teacher)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select assign_exam((select id from classrooms where name like 'Class 10A%'),(select id from exams where title='Algebra basics'), now()+interval '5 seconds', now()+interval '3 hours');
select assign_exam((select id from classrooms where name like 'Class 10A%'),(select id from exams where title like 'Thisis%'), now()+interval '5 seconds', now()+interval '3 hours');
select assign_exam((select id from classrooms where name like 'Class 10A%'),(select id from exams where title='Big exam'), now()+interval '5 seconds', now()+interval '3 hours');
select assign_exam((select id from classrooms where name like 'Superc%'),(select id from exams where title='Algebra basics'), now()+interval '5 seconds', now()+interval '3 hours');
insert into announcements (classroom_id,title,message) select id,'Welcome to the course '||repeat('verylongword',10),'Hello everyone '||repeat('Averyveryverylongunbreakabletext',5) from classrooms where name like 'Class 10A%';
-- widen windows so tests are robust to sandbox clock jumps
update assignments set starts_at = now() - interval '2 days', closes_at = now() + interval '60 days';
