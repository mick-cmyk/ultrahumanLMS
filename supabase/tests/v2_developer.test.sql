-- The developer keeps the highest access: nobody can demote, deactivate, unmark
-- or delete them, not even another admin or the service role, until the
-- developer approves a removal request.
begin;
select * from no_plan();

insert into public.units (id, parent_id, kind, name) values
 ('a8000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup');
insert into auth.users (id, email) values
 ('b8000000-0000-0000-0000-000000000001', 'developer@o.test'),
 ('b8000000-0000-0000-0000-000000000002', 'admin@o.test'),
 ('b8000000-0000-0000-0000-000000000003', 'learner@o.test');
update public.users set role='admin', unit_id='a8000000-0000-0000-0000-000000000001'
 where id in ('b8000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000002');

-- marking a developer: fine from a script (no signed-in user)
select lives_ok($$update public.users set is_developer = true where id = 'b8000000-0000-0000-0000-000000000001'$$, 'a script can mark the developer');
select throws_ok($$update public.users set is_developer = true where id = 'b8000000-0000-0000-0000-000000000003'$$, '22023', null,
  'a developer must be an active admin');

-- an admin can't touch the developer
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$update public.users set role = 'learner' where id = 'b8000000-0000-0000-0000-000000000001'$$, '42501', null, 'an admin cannot demote the developer');
select throws_ok($$update public.users set active = false where id = 'b8000000-0000-0000-0000-000000000001'$$, '42501', null, 'nor deactivate them');
select throws_ok($$update public.users set is_developer = true where id = 'b8000000-0000-0000-0000-000000000002'$$, '42501', null, 'nor make themselves a developer');
select lives_ok($$update public.users set full_name = 'Developer Name' where id = 'b8000000-0000-0000-0000-000000000001'$$, 'but can still fix their name');
select throws_ok($$select public.decide_developer_removal(gen_random_uuid(), true)$$, '42501', null, 'cannot decide anything');
create temp table req as select public.request_developer_removal('b8000000-0000-0000-0000-000000000001', 'Contract ended') as id;
select throws_ok($$select public.request_developer_removal('b8000000-0000-0000-0000-000000000001', 'Again')$$, '22023', null, 'one request at a time');
select throws_ok($$select public.decide_developer_removal((select id from req), true)$$, '42501', null, 'the admin cannot approve their own request');
select is((select count(*)::int from public.developer_requests_waiting()), 1, 'admins can see a request is waiting');
reset role;

-- a learner can't ask
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$select public.request_developer_removal('b8000000-0000-0000-0000-000000000001')$$, '42501', null, 'a learner cannot ask');
reset role;

-- even without a signed-in user (service role, scripts), no removal without approval
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$update public.users set role = 'viewer' where id = 'b8000000-0000-0000-0000-000000000001'$$, '42501', null, 'the service role cannot demote the developer');
select throws_ok($$delete from public.users where id = 'b8000000-0000-0000-0000-000000000001'$$, '42501', null, 'nor delete the account');

-- the developer sees it, and declines
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select reason from public.my_developer_requests()), 'Contract ended', 'the developer sees the request and reason');
select lives_ok($$select public.decide_developer_removal((select id from req), false)$$, 'the developer declines');
reset role;
select is((select is_developer from public.users where id = 'b8000000-0000-0000-0000-000000000001'), true, 'still the developer');

-- asked again, the developer approves
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000002', true);
set local role authenticated;
create temp table req2 as select public.request_developer_removal('b8000000-0000-0000-0000-000000000001', 'Handing over') as id;
reset role;
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.decide_developer_removal((select id from req2), true)$$, 'the developer approves');
reset role;
select is((select is_developer from public.users where id = 'b8000000-0000-0000-0000-000000000001'), false, 'no longer the developer');
select set_config('request.jwt.claim.sub','b8000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok($$update public.users set active = false where id = 'b8000000-0000-0000-0000-000000000001'$$, 'now an ordinary admin can deactivate them');
reset role;

select * from finish();
rollback;
