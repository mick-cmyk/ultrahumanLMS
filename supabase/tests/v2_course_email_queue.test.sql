-- Course emails: queued for the people an assignment reaches, once per person
-- per course, never to demo addresses; sent in hourly-limited batches; skipped
-- when they no longer apply; admins only.
-- Self-contained: builds its own fixtures, never relies on seed data.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
insert into public.units (id, parent_id, kind, name) values
 ('a4000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'store', 'S1'),
 ('a4000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000001', 'store', 'S2');

insert into auth.users (id, email) values
 ('b4000000-0000-0000-0000-000000000001', 'admin@q.test'),
 ('b4000000-0000-0000-0000-000000000002', 'one@q.test'),
 ('b4000000-0000-0000-0000-000000000003', 'two@q.test'),
 ('b4000000-0000-0000-0000-000000000004', 'gone@q.test'),
 ('b4000000-0000-0000-0000-000000000005', 'other@q.test'),
 ('b4000000-0000-0000-0000-000000000006', 'mgr@q.test');
update public.users set role='admin', unit_id='a4000000-0000-0000-0000-000000000001' where id='b4000000-0000-0000-0000-000000000001';
update public.users set unit_id='a4000000-0000-0000-0000-000000000002' where id in ('b4000000-0000-0000-0000-000000000002','b4000000-0000-0000-0000-000000000003');
update public.users set unit_id='a4000000-0000-0000-0000-000000000002', active=false where id='b4000000-0000-0000-0000-000000000004';
update public.users set unit_id='a4000000-0000-0000-0000-000000000003' where id='b4000000-0000-0000-0000-000000000005';
update public.users set role='manager', unit_id='a4000000-0000-0000-0000-000000000002' where id='b4000000-0000-0000-0000-000000000006';
insert into public.user_scopes (user_id, unit_id) values ('b4000000-0000-0000-0000-000000000006','a4000000-0000-0000-0000-000000000002');

insert into public.courses (id, title, published) values ('c4000000-0000-0000-0000-000000000001', 'Forklift', true);
insert into public.assignments (id, course_id, rule) values
 ('d4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', '{"unit_ids":["a4000000-0000-0000-0000-000000000002"]}');

-- ---------------------------------------------------------------- who may queue
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select throws_ok($$select public.queue_course_emails('d4000000-0000-0000-0000-000000000001')$$, '42501', null, 'a manager cannot queue course emails');
select throws_ok($$select * from public.course_email_schedule()$$, '42501', null, 'nor see the schedule');
select throws_ok($$select count(*) from public.course_email_queue$$, '42501', null, 'nor read the queue');
reset role;

-- ---------------------------------------------------------------- queueing
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
-- S1 has one, two, gone (inactive) and the manager: 3 active people match
select is(public.queue_course_emails('d4000000-0000-0000-0000-000000000001', now() + interval '2 days'), 3,
  'queues the active people the assignment reaches');
select is(public.queue_course_emails('d4000000-0000-0000-0000-000000000001', now()), 0, 'assigning again emails nobody twice');
select throws_ok($$select public.queue_course_emails('d4000000-0000-0000-0000-000000000001', now() + interval '2 years')$$,
  '22023', null, 'a send time more than a year away is refused');
select is((select queued from public.course_email_schedule()), 3, 'the schedule shows 3 waiting');
reset role;
select is((select count(*)::int from public.course_email_queue where user_id = 'b4000000-0000-0000-0000-000000000004'), 0, 'inactive people are not queued');
select is((select count(*)::int from public.course_email_queue where user_id = 'b4000000-0000-0000-0000-000000000005'), 0, 'people outside the assignment are not queued');

-- demo addresses are never queued
update public.app_settings set value = 'demo' where key = 'environment';
insert into auth.users (id, email, raw_user_meta_data) values ('b4000000-0000-0000-0000-000000000007', 'demo@q.invalid', '{"demo_tag":"t"}');
update public.users set unit_id='a4000000-0000-0000-0000-000000000003' where id='b4000000-0000-0000-0000-000000000007';
insert into public.assignments (id, course_id, rule) values
 ('d4000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000001', '{"unit_ids":["a4000000-0000-0000-0000-000000000003"]}');
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(public.queue_course_emails('d4000000-0000-0000-0000-000000000002'), 1, 'S2: the real address is queued, the demo one is not');
reset role;

-- ---------------------------------------------------------------- sending
-- (as the owner, standing in for the service-role sender)
select is((select count(*)::int from public.claim_course_emails()), 1, 'only what is due is claimed (the S1 batch is in two days)');
select is((select status from public.course_email_queue where user_id = 'b4000000-0000-0000-0000-000000000005'), 'sending', 'the claimed row is marked sending');
select is((select count(*)::int from public.claim_course_emails()), 0, 'a second run does not claim it again');
select lives_ok($$select public.finish_course_email((select id from public.course_email_queue where user_id = 'b4000000-0000-0000-0000-000000000005'), true)$$, 'record it as sent');
select is((select status from public.course_email_queue where user_id = 'b4000000-0000-0000-0000-000000000005'), 'sent', 'and it is sent');

-- hourly limit of 2, one already sent this hour: only one more goes
update public.app_settings set value = '2' where key = 'email_hourly_limit';
update public.course_email_queue set send_after = now() - interval '1 minute' where assignment_id = 'd4000000-0000-0000-0000-000000000001';
create temp table run1 as select * from public.claim_course_emails();
select is((select count(*)::int from run1), 1, 'the hourly limit holds the rest back');
select lives_ok($$select public.finish_course_email((select id from run1), true)$$, 'that one is sent');
select is((select count(*)::int from public.claim_course_emails()), 0, 'limit reached: nothing more this hour');
select is((select count(*)::int from public.course_email_queue where status = 'queued'), 2, 'two still waiting for the next hour');

-- no longer applies: someone deactivated before their email goes
update public.app_settings set value = '100' where key = 'email_hourly_limit';
update public.users set active = false where id = 'b4000000-0000-0000-0000-000000000003';
create temp table run2 as select * from public.claim_course_emails();
select ok(not exists (select 1 from run2 where user_id = 'b4000000-0000-0000-0000-000000000003'), 'a deactivated person is not sent the email');
select is((select status from public.course_email_queue where user_id = 'b4000000-0000-0000-0000-000000000003' and course_id = 'c4000000-0000-0000-0000-000000000001'),
  'skipped', 'their row is skipped');

-- a failed send is retried, then given up on after three tries
select lives_ok($$select public.finish_course_email((select id from run2 limit 1), false, 'Resend said no')$$, 'record a failure');
select is((select status from public.course_email_queue where id = (select id from run2 limit 1)), 'queued', 'it goes back in the queue');
select ok((select send_after > now() from public.course_email_queue where id = (select id from run2 limit 1)), 'and waits before trying again');
update public.course_email_queue set send_after = now() - interval '1 minute' where id = (select id from run2 limit 1);
select public.finish_course_email(id, false, 'again') from public.claim_course_emails();
update public.course_email_queue set send_after = now() - interval '1 minute' where id = (select id from run2 limit 1);
select public.finish_course_email(id, false, 'and again') from public.claim_course_emails();
select is((select status from public.course_email_queue where id = (select id from run2 limit 1)), 'failed', 'after three tries it stops');
select is((select last_error from public.course_email_queue where id = (select id from run2 limit 1)), 'and again', 'keeping the last error');

-- an unpublished course is not announced
insert into public.courses (id, title, published) values ('c4000000-0000-0000-0000-000000000002', 'Draft', false);
insert into public.assignments (id, course_id, rule) values
 ('d4000000-0000-0000-0000-000000000003', 'c4000000-0000-0000-0000-000000000002', '{"all":true}');
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select ok(public.queue_course_emails('d4000000-0000-0000-0000-000000000003') > 0, 'emails for a draft course can be queued');
reset role;
select is((select count(*)::int from public.claim_course_emails() where course_id = 'c4000000-0000-0000-0000-000000000002'), 0, 'but are not sent while it is a draft');
select is((select count(*)::int from public.course_email_queue where course_id = 'c4000000-0000-0000-0000-000000000002' and status <> 'skipped'), 0, 'they are skipped');

-- cancelling
insert into public.courses (id, title, published) values ('c4000000-0000-0000-0000-000000000003', 'Later', true);
insert into public.assignments (id, course_id, rule) values
 ('d4000000-0000-0000-0000-000000000004', 'c4000000-0000-0000-0000-000000000003', '{"all":true}');
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select ok(public.queue_course_emails('d4000000-0000-0000-0000-000000000004', now() + interval '3 days') > 0, 'queue some for later');
select ok(public.cancel_course_emails('d4000000-0000-0000-0000-000000000004') > 0, 'admin cancels them');
select is((select queued from public.course_email_schedule() where assignment_id = 'd4000000-0000-0000-0000-000000000004'), 0, 'nothing left waiting');
select throws_ok($$select public.set_email_hourly_limit(0)$$, '22023', null, 'the hourly limit must be at least 1');
select lives_ok($$select public.set_email_hourly_limit(250)$$, 'admin sets the hourly limit');
select is(public.email_hourly_limit(), 250, 'and it sticks');
reset role;

-- ---------------------------------------------------------------- privileges
select ok(not has_function_privilege('authenticated', 'public.claim_course_emails()', 'execute'), 'only the sender claims');
select ok(not has_function_privilege('authenticated', 'public.finish_course_email(uuid,boolean,text)', 'execute'), 'only the sender records results');
select ok(not has_function_privilege('anon', 'public.queue_course_emails(uuid,timestamptz)', 'execute'), 'anon cannot queue');

select * from finish();
rollback;
