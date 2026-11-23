-- Messages: announcements (audience, scope, acknowledgements, emails),
-- questions (who sees a conversation, who may start one) and discussions
-- (store-only groups, off by default, moderation).
-- Self-contained: builds its own fixtures, never relies on seed data.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
-- Sup > Brand > (S1, S2); Other brand > S3
insert into public.units (id, parent_id, kind, name) values
 ('a7000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 'retailer', 'Brand'),
 ('a7000000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-000000000002', 'store', 'S1'),
 ('a7000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-000000000002', 'store', 'S2'),
 ('a7000000-0000-0000-0000-000000000005', 'a7000000-0000-0000-0000-000000000001', 'retailer', 'Rival'),
 ('a7000000-0000-0000-0000-000000000006', 'a7000000-0000-0000-0000-000000000005', 'store', 'S3');

insert into auth.users (id, email) values
 ('b7000000-0000-0000-0000-000000000001', 'admin@m.test'),
 ('b7000000-0000-0000-0000-000000000002', 'brandmgr@m.test'),
 ('b7000000-0000-0000-0000-000000000003', 's1mgr@m.test'),
 ('b7000000-0000-0000-0000-000000000004', 'ann@m.test'),
 ('b7000000-0000-0000-0000-000000000005', 'bob@m.test'),
 ('b7000000-0000-0000-0000-000000000006', 'cat@m.test'),
 ('b7000000-0000-0000-0000-000000000007', 'rival@m.test');
update public.users set role='admin', unit_id='a7000000-0000-0000-0000-000000000001' where id='b7000000-0000-0000-0000-000000000001';
update public.users set role='manager', unit_id='a7000000-0000-0000-0000-000000000002' where id='b7000000-0000-0000-0000-000000000002';
update public.users set role='manager', unit_id='a7000000-0000-0000-0000-000000000003' where id='b7000000-0000-0000-0000-000000000003';
update public.users set unit_id='a7000000-0000-0000-0000-000000000003' where id in ('b7000000-0000-0000-0000-000000000004','b7000000-0000-0000-0000-000000000005');
update public.users set unit_id='a7000000-0000-0000-0000-000000000004' where id='b7000000-0000-0000-0000-000000000006';
update public.users set unit_id='a7000000-0000-0000-0000-000000000006' where id='b7000000-0000-0000-0000-000000000007';
insert into public.user_scopes (user_id, unit_id) values
 ('b7000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000002'),
 ('b7000000-0000-0000-0000-000000000003','a7000000-0000-0000-0000-000000000003');

insert into public.courses (id, title, published) values ('c7000000-0000-0000-0000-000000000001', 'Course', true);
insert into public.modules (id, course_id, title, sort_order) values ('c7100000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000001', 'M', 1);
insert into public.lessons (id, module_id, title, sort_order, duration_seconds) values
 ('c7200000-0000-0000-0000-000000000001', 'c7100000-0000-0000-0000-000000000001', 'L', 1, 60);
insert into public.assignments (course_id, rule) values ('c7000000-0000-0000-0000-000000000001', '{"all":true}');

-- ---------------------------------------------------------------- announcements
-- a learner can't post
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok($$select public.post_announcement('Hi','Body',null,'{"all":true}')$$, '42501', null, 'a learner cannot post an announcement');
select throws_ok($$select count(*) from public.announcements$$, '42501', null, 'nor read the table directly');
reset role;

-- the S1 manager posting to "everyone" reaches only S1 (their scope), not themselves
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is(public.announcement_reach('{"all":true}'), 2, 'a store manager''s "everyone" is their own store');
select is(public.announcement_reach('{"unit_ids":["a7000000-0000-0000-0000-000000000004"]}'), 0, 'they cannot reach another store');
select throws_ok($$select public.post_announcement('Hi','Body',null,'{"unit_ids":["a7000000-0000-0000-0000-000000000004"]}')$$,
  '22023', null, 'posting to nobody is refused');
select is((public.post_announcement('Roster', 'New roster is up', 'https://example.com/r', '{"all":true}', 'My store', true)) ->> 'recipients',
  '2', 'posted to the two S1 staff');
reset role;
select is((select count(*)::int from public.message_email_queue where kind = 'announcement'), 2, 'important: both are queued an email');
select ok((select bool_and(send_after >= now()) from public.message_email_queue), 'emails wait for the 8am to 8pm window');

-- admin reaches everyone but themselves, across brands
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(public.announcement_reach('{"all":true}'), 6, 'an admin''s everyone is the whole network');
select throws_ok($$select public.post_announcement('', 'Body', null, '{"all":true}')$$, '23514', null, 'a blank title is refused');
select throws_ok($$select public.post_announcement('T', 'Body', 'javascript:alert(1)', '{"all":true}')$$, '23514', null, 'only https links');
reset role;

-- Ann sees it, acknowledges it
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select is((select count(*)::int from public.my_announcements()), 1, 'Ann has one announcement');
select is((public.message_counts() ->> 'unacknowledged')::int, 1, 'and it counts as not yet acknowledged');
select lives_ok($$select public.acknowledge_announcement((select id from public.my_announcements() limit 1))$$, 'Ann taps Got it');
select is((public.message_counts() ->> 'unacknowledged')::int, 0, 'now acknowledged');
select throws_ok($$select * from public.sent_announcements()$$, '42501', null, 'a learner has no sent list');
reset role;

-- Cat (S2) never got it
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select is((select count(*)::int from public.my_announcements()), 0, 'someone in another store does not get it');
reset role;

-- the author sees the counts and who is outstanding
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select acknowledged from public.sent_announcements()), 1, 'one acknowledged');
select is((select count(*)::int from public.announcement_outstanding((select id from public.sent_announcements()))), 1, 'one outstanding (Bob)');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select * from public.announcement_outstanding((select id from public.announcements limit 1))$$, '42501', null,
  'another manager cannot see someone else''s outstanding list');
reset role;

-- the email: Ann read it so hers is skipped, Bob's is claimed
select is((select count(*)::int from public.message_email_queue where status = 'queued'), 2, 'two waiting');
update public.message_email_queue set send_after = now() - interval '1 minute';
create temp table mrun as select * from public.claim_message_emails();
select is((select count(*)::int from mrun), 1, 'only the unread one is sent');
select is((select email from mrun), 'bob@m.test', 'to Bob');
select is((select title from mrun), 'Roster', 'with the title');
select is((select status from public.message_email_queue q join public.users u on u.id = q.user_id where u.email = 'ann@m.test'), 'skipped', 'Ann''s is skipped');

-- the hourly limit is shared with course emails
select lives_ok($$select public.finish_message_email((select id from mrun), true)$$, 'Bob''s sent');
update public.app_settings set value = '1' where key = 'email_hourly_limit';
select is(public._email_room(), 0, 'one message email this hour uses up a limit of 1');
update public.app_settings set value = '100' where key = 'email_hourly_limit';

-- deleting cancels waiting emails and hides it
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok($$select public.delete_announcement((select id from public.my_announcements() limit 1))$$, '42501', null, 'a recipient cannot delete it');
reset role;

-- ---------------------------------------------------------------- send window
select is(public._next_send_time('2026-11-26 10:00:00+11'), '2026-11-26 10:00:00+11'::timestamptz, '10am Sydney: send now');
select is(public._next_send_time('2026-11-26 21:30:00+11'), '2026-11-27 08:00:00+11'::timestamptz, '9:30pm Sydney: next morning at 8');
select is(public._next_send_time('2026-11-26 06:00:00+11'), '2026-11-26 08:00:00+11'::timestamptz, '6am Sydney: 8am the same day');

-- ---------------------------------------------------------------- questions
delete from public.message_email_queue;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000004', true);
set local role authenticated;
create temp table t1 as select public.start_thread('Roster question', 'Can I swap Saturday?') as id;
select is((select count(*)::int from public.my_threads()), 1, 'Ann sees her question');
select throws_ok($$select public.start_thread('Hi', 'Hi', 'b7000000-0000-0000-0000-000000000005')$$, '42501', null,
  'a learner cannot start a conversation about someone else (no private messages)');
reset role;
-- the nearest manager (S1) is told, not the brand manager
select is((select array_agg(u.email) from public.message_email_queue q join public.users u on u.id = q.user_id where q.kind = 'thread'),
  array['s1mgr@m.test'], 'the nearest manager is emailed');

-- Bob (same store) cannot see it; the S1 and brand managers and the admin can
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((select count(*)::int from public.my_threads()), 0, 'a workmate cannot see it');
select throws_ok($$select public.get_thread((select id from t1))$$, '42501', null, 'nor open it');
select throws_ok($$select public.reply_thread((select id from t1), 'me too')$$, '42501', null, 'nor reply');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000007', true);
set local role authenticated;
select is((select count(*)::int from public.my_threads()), 0, 'someone at the rival brand cannot see it');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*)::int from public.my_threads()), 1, 'the brand manager above can see it');
select is((select waiting from public.my_threads()), true, 'and it is waiting for a reply');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select unread from public.my_threads()), true, 'unread for the store manager');
select lives_ok($$select public.reply_thread((select id from t1), 'Yes, swap with Bob')$$, 'the store manager replies');
select is((select waiting from public.my_threads()), false, 'no longer waiting');
select is(jsonb_array_length(public.get_thread((select id from t1)) -> 'messages'), 2, 'two messages');
-- a manager may message someone in their area, not outside it
select lives_ok($$select public.start_thread('Shift', 'Can you cover Sunday?', 'b7000000-0000-0000-0000-000000000005')$$, 'the store manager messages Bob');
select throws_ok($$select public.start_thread('Hi', 'Hi', 'b7000000-0000-0000-0000-000000000006')$$, '42501', null,
  'but not someone in another store');
reset role;
select is((select count(*)::int from public.message_email_queue q join public.users u on u.id = q.user_id where u.email = 'ann@m.test'), 1,
  'Ann is emailed about the reply');
-- (one transaction, one now(): put Ann's earlier read before the reply)
update public.thread_reads set read_at = now() - interval '1 hour' where user_id = 'b7000000-0000-0000-0000-000000000004';
-- Ann opens it: her waiting email is no longer needed
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select is((public.message_counts() ->> 'threads')::int, 1, 'Ann has one unread conversation');
select lives_ok($$select public.get_thread((select id from t1))$$, 'Ann opens it');
select is((public.message_counts() ->> 'threads')::int, 0, 'now read');
reset role;
update public.message_email_queue set send_after = now() - interval '1 minute', created_at = now() - interval '1 minute';
create temp table mrun2 as select * from public.claim_message_emails();
select ok(not exists (select 1 from mrun2 where email = 'ann@m.test'), 'a conversation already read is not emailed');

-- ---------------------------------------------------------------- discussions
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok($$select public.post_discussion('c7200000-0000-0000-0000-000000000001', 'Hello')$$, '22023', null, 'off by default');
select is(public.lesson_discussion('c7200000-0000-0000-0000-000000000001'), '[]'::jsonb, 'nothing shows while off');
select throws_ok($$select public.set_discussion_mode('unit')$$, '42501', null, 'a learner cannot turn it on');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.set_discussion_mode('unit')$$, 'an admin turns it on');
reset role;

select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000004', true);
set local role authenticated;
create temp table p1 as select public.post_discussion('c7200000-0000-0000-0000-000000000001', 'Tip: ask what it is for') as id;
select is(jsonb_array_length(public.lesson_discussion('c7200000-0000-0000-0000-000000000001')), 1, 'Ann sees her post');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is(jsonb_array_length(public.lesson_discussion('c7200000-0000-0000-0000-000000000001')), 1, 'Bob (same store) sees it');
select lives_ok($$select public.post_discussion('c7200000-0000-0000-0000-000000000001', 'Good one', (select id from p1))$$, 'Bob replies');
select lives_ok($$select public.report_discussion_post((select id from p1))$$, 'Bob reports it');
select throws_ok($$select public.moderate_discussion_post((select id from p1), 'hide')$$, '42501', null, 'Bob cannot hide it');
select is((public.lesson_discussion('c7200000-0000-0000-0000-000000000001') -> 0 ->> 'reported')::boolean, false, 'Bob does not see report flags');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select is(jsonb_array_length(public.lesson_discussion('c7200000-0000-0000-0000-000000000001')), 0, 'Cat (another store) sees nothing');
select throws_ok($$select public.post_discussion('c7200000-0000-0000-0000-000000000001', 'x', (select id from public.discussion_posts limit 1))$$,
  '42501', null, 'and cannot reply into another store');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(jsonb_array_length(public.lesson_discussion('c7200000-0000-0000-0000-000000000001')), 2, 'the brand manager sees the store''s posts');
select is((select count(*)::int from public.reported_discussion_posts()), 1, 'and the report');
select lives_ok($$select public.moderate_discussion_post((select id from p1), 'hide')$$, 'and hides the post');
select is((select count(*)::int from public.reported_discussion_posts()), 0, 'report dealt with');
select is((select x ->> 'body' from jsonb_array_elements(public.lesson_discussion('c7200000-0000-0000-0000-000000000001')) x where x ->> 'parent_id' is null), null, 'a hidden post with replies shows as a placeholder');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000007', true);
set local role authenticated;
select is(jsonb_array_length(public.lesson_discussion('c7200000-0000-0000-0000-000000000001')), 0, 'the rival brand sees nothing');
reset role;

select * from finish();
rollback;
