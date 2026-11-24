-- Written answers to the manager: only admins switch it on, switching it does
-- not send the lesson back for review, a ticked prompt's answer becomes a
-- conversation for the nearest manager (with an email queued), an unticked one
-- doesn't, a second submit sends nothing, and with no manager the admins get it.
begin;
select * from no_plan();

insert into public.units (id, parent_id, kind, name) values
 ('a8000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a8000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000001', 'store', 'Managed store'),
 ('a8000000-0000-0000-0000-000000000003', 'a8000000-0000-0000-0000-000000000001', 'store', 'Unmanaged store');
insert into auth.users (id, email) values
 ('b8000000-0000-0000-0000-000000000001', 'admin@wm.test'),
 ('b8000000-0000-0000-0000-000000000002', 'floor@wm.test'),
 ('b8000000-0000-0000-0000-000000000003', 'boss@wm.test'),
 ('b8000000-0000-0000-0000-000000000004', 'alone@wm.test');
update public.users set role='admin', unit_id='a8000000-0000-0000-0000-000000000001' where id='b8000000-0000-0000-0000-000000000001';
update public.users set unit_id='a8000000-0000-0000-0000-000000000002' where id='b8000000-0000-0000-0000-000000000002';
update public.users set role='manager', unit_id='a8000000-0000-0000-0000-000000000002' where id='b8000000-0000-0000-0000-000000000003';
update public.users set unit_id='a8000000-0000-0000-0000-000000000003' where id='b8000000-0000-0000-0000-000000000004';
insert into public.user_scopes (user_id, unit_id) values ('b8000000-0000-0000-0000-000000000003', 'a8000000-0000-0000-0000-000000000002');

insert into public.courses (id, title, published) values ('c8000000-0000-0000-0000-000000000001', 'C', true);
insert into public.modules (id, course_id, title) values ('d8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', 'M');
insert into public.lessons (id, module_id, title) values ('e8000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001', 'Ring sizing');
insert into public.assignments (course_id, rule) values ('c8000000-0000-0000-0000-000000000001', '{"all":true}');
insert into public.written_prompts (lesson_id, id, sort_order, prompt, model_answer) values
 ('e8000000-0000-0000-0000-000000000001', 'send', 1, 'Explain how you size a ring.', 'Snug, not spinning.'),
 ('e8000000-0000-0000-0000-000000000001', 'keep', 2, 'What else matters?', null);
update public.lessons set reviewed_at = now() where id = 'e8000000-0000-0000-0000-000000000001';
insert into public.lesson_progress (user_id, lesson_id, watch_pct, watched_at) values
 ('b8000000-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-000000000001', 1, now()),
 ('b8000000-0000-0000-0000-000000000004', 'e8000000-0000-0000-0000-000000000001', 1, now());

-- only admins switch it on
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$select public.set_written_prompt_send('e8000000-0000-0000-0000-000000000001', 'send', true)$$,
  '42501', null, 'a manager cannot switch it on');
reset role;
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.set_written_prompt_send('e8000000-0000-0000-0000-000000000001', 'send', true)$$,
  'an admin switches it on');
select throws_ok($$select public.set_written_prompt_send('e8000000-0000-0000-0000-000000000001', 'nope', true)$$,
  '22023', null, 'an unknown prompt is refused');
reset role;
select ok((select reviewed_at is not null from public.lessons where id = 'e8000000-0000-0000-0000-000000000001'),
  'switching it does not send the lesson back for review');

-- the learner sees it and answers
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select (x->>'send_to_manager')::boolean from jsonb_array_elements(public.get_written_prompts('e8000000-0000-0000-0000-000000000001')) x where x->>'id' = 'send'),
  true, 'staff can see their answer goes to their manager');
select is((public.submit_written_answer('e8000000-0000-0000-0000-000000000001', 'send', 'Try sizing rings first.')->>'sent_to_manager')::boolean,
  true, 'answering a ticked prompt sends it');
select is((public.submit_written_answer('e8000000-0000-0000-0000-000000000001', 'send', 'A second go')->>'sent_to_manager')::boolean,
  false, 'a second submit sends nothing more');
select is((public.submit_written_answer('e8000000-0000-0000-0000-000000000001', 'keep', 'Comfort.')->>'sent_to_manager')::boolean,
  false, 'an unticked prompt is not sent');
reset role;

select is((select count(*)::int from public.threads where subject_user_id = 'b8000000-0000-0000-0000-000000000002'), 1,
  'one conversation');
select ok((select body like 'Question: Explain how you size a ring.%Try sizing rings first.' from public.thread_messages m
           join public.threads t on t.id = m.thread_id where t.subject_user_id = 'b8000000-0000-0000-0000-000000000002'),
  'it holds the question and the answer');
select is((select lesson_id from public.threads where subject_user_id = 'b8000000-0000-0000-0000-000000000002'),
  'e8000000-0000-0000-0000-000000000001'::uuid, 'linked to the lesson');
select is((select array_agg(user_id) from public.message_email_queue q join public.threads t on t.id = q.ref_id
           where t.subject_user_id = 'b8000000-0000-0000-0000-000000000002'),
  array['b8000000-0000-0000-0000-000000000003'::uuid], 'the nearest manager is emailed, nobody else');

-- the manager can read it, through their own Messages list
create temp table sent_thread as select id from public.threads where subject_user_id = 'b8000000-0000-0000-0000-000000000002';
grant select on sent_thread to authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select ok(public.get_thread((select id from sent_thread)) is not null, 'the manager can open the conversation');
reset role;

-- no manager above: the admins get it
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select is((public.submit_written_answer('e8000000-0000-0000-0000-000000000001', 'send', 'Snug fit.')->>'sent_to_manager')::boolean,
  true, 'sent with no manager too');
reset role;
select is((select array_agg(user_id) from public.message_email_queue q join public.threads t on t.id = q.ref_id
           where t.subject_user_id = 'b8000000-0000-0000-0000-000000000004'),
  array['b8000000-0000-0000-0000-000000000001'::uuid], 'with no manager, the admin is emailed');

select * from finish();
rollback;
