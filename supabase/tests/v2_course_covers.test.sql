-- Course covers: only admins write them, only under an existing course's
-- folder, with the expected file name; the column only takes those names.
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

insert into public.units (id, parent_id, kind, name) values
 ('a2000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup');
insert into auth.users (id, email) values
 ('b2000000-0000-0000-0000-000000000001', 'admin@cov.test'),
 ('b2000000-0000-0000-0000-000000000002', 'mgr@cov.test'),
 ('b2000000-0000-0000-0000-000000000003', 'floor@cov.test');
update public.users set role='admin', unit_id='a2000000-0000-0000-0000-000000000001' where id='b2000000-0000-0000-0000-000000000001';
update public.users set role='manager', unit_id='a2000000-0000-0000-0000-000000000001' where id='b2000000-0000-0000-0000-000000000002';
update public.users set role='learner', unit_id='a2000000-0000-0000-0000-000000000001' where id='b2000000-0000-0000-0000-000000000003';
insert into public.courses (id, title, published) values ('c2000000-0000-0000-0000-000000000001', 'Cov', true);

select is((select public from storage.buckets where id = 'course-covers'), true, 'covers bucket is public');
select is((select file_size_limit from storage.buckets where id = 'course-covers'), 1048576::bigint, 'covers are limited to 1 MB');

-- The column only takes <course>/<uuid>.jpg|webp.
select lives_ok($$update public.courses set cover_path = 'c2000000-0000-0000-0000-000000000001/d2000000-0000-0000-0000-000000000001.jpg' where id = 'c2000000-0000-0000-0000-000000000001'$$, 'a proper cover path is accepted');
select throws_ok($$update public.courses set cover_path = 'https://evil.example/x.jpg' where id = 'c2000000-0000-0000-0000-000000000001'$$, '23514', null, 'a URL is not a cover path');
select throws_ok($$update public.courses set cover_path = '../x.jpg' where id = 'c2000000-0000-0000-0000-000000000001'$$, '23514', null, 'odd names are refused');

-- Admin can upload under an existing course, nowhere else.
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values ('course-covers', 'c2000000-0000-0000-0000-000000000001/d2000000-0000-0000-0000-000000000002.webp')$$, 'admin uploads a cover');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('course-covers', 'c2000000-0000-0000-0000-000000000009/d2000000-0000-0000-0000-000000000002.jpg')$$, '42501', null, 'not under a course that does not exist');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('course-covers', 'c2000000-0000-0000-0000-000000000001/page.html')$$, '42501', null, 'not with another kind of file name');
select is((select count(*)::int from storage.objects where bucket_id = 'course-covers'), 1, 'admin can list covers');
select lives_ok($$delete from storage.objects where bucket_id = 'course-covers'$$, 'admin can delete covers');
reset role;

-- Managers and learners cannot write covers.
insert into storage.objects (bucket_id, name) values ('course-covers', 'c2000000-0000-0000-0000-000000000001/d2000000-0000-0000-0000-000000000003.jpg');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$insert into storage.objects (bucket_id, name) values ('course-covers', 'c2000000-0000-0000-0000-000000000001/d2000000-0000-0000-0000-000000000004.jpg')$$, '42501', null, 'manager cannot upload a cover');
delete from storage.objects where bucket_id = 'course-covers';
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'course-covers'), 1, 'manager cannot delete a cover');
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$insert into storage.objects (bucket_id, name) values ('course-covers', 'c2000000-0000-0000-0000-000000000001/d2000000-0000-0000-0000-000000000005.jpg')$$, '42501', null, 'learner cannot upload a cover');
update public.courses set cover_path = null where id = 'c2000000-0000-0000-0000-000000000001';
reset role;
select ok((select cover_path is not null from public.courses where id = 'c2000000-0000-0000-0000-000000000001'), 'learner cannot change a course cover');

select ok(not has_function_privilege('anon', 'public.cover_object_course(text)', 'execute'), 'anon cannot run the cover name check');

select * from finish();
rollback;
