-- Self-registration: the public page only shows what it should, requests land
-- pending or approved by the setting, existing logins are never touched, and
-- only approvers in the right area (or admins) can decide.
-- Self-contained: builds its own fixtures, never relies on seed data.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
-- Sup > Brand > S1, S2
insert into public.units (id, parent_id, kind, name, active) values
 ('a3000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup', true),
 ('a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'retailer', 'Brand', true),
 ('a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000002', 'store', 'S1', true),
 ('a3000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000002', 'store', 'S2', true),
 ('a3000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000001', 'store', 'Closed', false);

insert into auth.users (id, email) values
 ('b3000000-0000-0000-0000-000000000001', 'admin@sr.test'),
 ('b3000000-0000-0000-0000-000000000002', 'mgr1@sr.test'),
 ('b3000000-0000-0000-0000-000000000003', 'mgr2@sr.test'),
 ('b3000000-0000-0000-0000-000000000004', 'floor@sr.test'),
 ('b3000000-0000-0000-0000-000000000005', 'plainmgr@sr.test');
update public.users set role='admin', is_approver=true, unit_id='a3000000-0000-0000-0000-000000000001' where id='b3000000-0000-0000-0000-000000000001';
update public.users set role='manager', is_approver=true, unit_id='a3000000-0000-0000-0000-000000000003' where id='b3000000-0000-0000-0000-000000000002';
update public.users set role='manager', is_approver=true, unit_id='a3000000-0000-0000-0000-000000000004' where id='b3000000-0000-0000-0000-000000000003';
update public.users set role='learner', unit_id='a3000000-0000-0000-0000-000000000003' where id='b3000000-0000-0000-0000-000000000004';
update public.users set role='manager', is_approver=false, unit_id='a3000000-0000-0000-0000-000000000003' where id='b3000000-0000-0000-0000-000000000005';
insert into public.user_scopes (user_id, unit_id) values
 ('b3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000003'),
 ('b3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000004'),
 ('b3000000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-000000000003');

-- ------------------------------------------------------- the public page (anon)
set local role anon;
select is(public.registration_options(null) ->> 'open', 'false', 'general page is off by default');
select is(public.registration_options('nope') ->> 'open', 'false', 'an unknown code shows nothing');
select throws_ok($$select public.submit_registration('x@y.test','X',null,null)$$, '42501', null, 'anon cannot submit directly');
select throws_ok($$select * from public.pending_registrations()$$, '42501', null, 'anon cannot list requests');
select throws_ok($$select count(*) from public.registration_requests$$, '42501', null, 'anon cannot read the table');
reset role;

-- ------------------------------------------------------- settings and links
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok($$select public.set_registration_settings(true, false)$$, '42501', null, 'a learner cannot change the settings');
select throws_ok($$select public.set_unit_signup('a3000000-0000-0000-0000-000000000003', true)$$, '42501', null, 'a learner cannot make a link');
select lives_ok($$update public.users set is_approver = true where id = 'b3000000-0000-0000-0000-000000000004'$$, 'a learner trying to become an approver is quietly ignored (RLS)');
reset role;
select is((select is_approver from public.users where id = 'b3000000-0000-0000-0000-000000000004'), false, 'learner is still not an approver');

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select public.set_unit_signup('a3000000-0000-0000-0000-000000000004', true)$$, '42501', null, 'a manager cannot make a link for another store');
select ok(public.set_unit_signup('a3000000-0000-0000-0000-000000000003', true) is not null, 'a manager makes a link for their own store');
reset role;

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.set_registration_settings(true, false)$$, 'admin turns the general page on');
select is(public.registration_settings() ->> 'general', 'true', 'admin reads the settings back');
select ok(public.set_unit_signup('a3000000-0000-0000-0000-000000000004', true) is not null, 'admin makes a link for S2');
reset role;

set local role anon;
select is(public.registration_options(null) ->> 'open', 'true', 'general page now open');
select is(jsonb_array_length(public.registration_options(null) -> 'units'), 4, 'list shows active places only');
reset role;
-- (anon can't read units to look the code up, so fetch it as the owner)
select is(public.registration_options((select signup_code from public.units where id = 'a3000000-0000-0000-0000-000000000004')) #>> '{unit,name}',
  'S2', 'a place link shows just that place');

-- ------------------------------------------------------- submitting (service role path)
select is(public.submit_registration('New.One@Example.test', 'New One', 'a3000000-0000-0000-0000-000000000003', null) ->> 'status',
  'pending', 'a request waits when auto-approve is off');
select is((select email from public.registration_requests where full_name = 'New One'), 'new.one@example.test', 'email is stored in lower case');
select is(public.submit_registration('new.one@example.test', 'New One Again', 'a3000000-0000-0000-0000-000000000003', null) ->> 'notify',
  'false', 'asking again does not email approvers twice');
select is((select count(*)::int from public.registration_requests where email = 'new.one@example.test'), 1, 'still one request');
select is(public.submit_registration('floor@sr.test', 'Sneaky', 'a3000000-0000-0000-0000-000000000004', null) ->> 'status',
  'existing', 'an existing login is reported, not changed');
select is((select unit_id from public.users where id = 'b3000000-0000-0000-0000-000000000004'), 'a3000000-0000-0000-0000-000000000003'::uuid,
  'and they stay where they were');
select throws_ok($$select public.submit_registration('x@demo.invalid','X','a3000000-0000-0000-0000-000000000003',null)$$, '22023', null, 'demo addresses are refused');
select throws_ok($$select public.submit_registration('not-an-email','X','a3000000-0000-0000-0000-000000000003',null)$$, '22023', null, 'bad email refused');
select throws_ok($$select public.submit_registration('a@b.test','  ','a3000000-0000-0000-0000-000000000003',null)$$, '22023', null, 'blank name refused');
select throws_ok($$select public.submit_registration('a@b.test','A','a3000000-0000-0000-0000-000000000005',null)$$, '22023', null, 'an inactive place is refused');
select is(public.submit_registration('s2@example.test', 'S2 Person', null,
  (select signup_code from public.units where id = 'a3000000-0000-0000-0000-000000000004')) ->> 'status',
  'pending', 'a place link works without the general page');

-- fixed ids so the role-switched checks below don't need to read the table
update public.registration_requests set id = 'f3000000-0000-0000-0000-000000000001' where email = 'new.one@example.test';
update public.registration_requests set id = 'f3000000-0000-0000-0000-000000000002' where email = 's2@example.test';

-- approvers to email
select is((select array_agg(email order by email) from public.registration_approvers('a3000000-0000-0000-0000-000000000003')),
  array['admin@sr.test','mgr1@sr.test'], 'S1 requests go to the admin and the S1 approver only');

-- ------------------------------------------------------- deciding
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.pending_registrations()), 1, 'S2 approver sees only the S2 request');
select throws_ok($$select * from public.registration_for_approval('f3000000-0000-0000-0000-000000000001')$$,
  '42501', 'registration: not allowed', 'S2 approver cannot approve an S1 request');
select throws_ok($$select public.decide_registration('f3000000-0000-0000-0000-000000000001', true)$$,
  '42501', 'registration: not allowed', 'nor decide it directly');
reset role;

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((select count(*)::int from public.pending_registrations()), 0, 'a manager who is not an approver sees nothing');
reset role;

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select full_name from public.registration_for_approval('f3000000-0000-0000-0000-000000000001')),
  'New One Again', 'S1 approver gets the details to approve');
select lives_ok($$select public.decide_registration('f3000000-0000-0000-0000-000000000001', true, null)$$,
  'S1 approver approves');
select is((select count(*)::int from public.pending_registrations()), 0, 'it leaves the list');
reset role;
select is((select status from public.registration_requests where email = 'new.one@example.test'), 'approved', 'request is approved');
select is((select decided_by from public.registration_requests where email = 'new.one@example.test'), 'b3000000-0000-0000-0000-000000000002'::uuid, 'and records who approved');

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*)::int from public.pending_registrations()), 1, 'admin sees the remaining request');
select lives_ok($$select public.decide_registration('f3000000-0000-0000-0000-000000000002', false)$$, 'admin declines');
select throws_ok($$select public.decide_registration('f3000000-0000-0000-0000-000000000002', true)$$,
  '22023', null, 'a decided request cannot be decided again');

-- auto-approve
select lives_ok($$select public.set_registration_settings(false, true)$$, 'admin turns auto-approve on and the general page off');
reset role;
select is(public.submit_registration('auto@example.test', 'Auto', null,
  (select signup_code from public.units where id = 'a3000000-0000-0000-0000-000000000004')) ->> 'status',
  'approved', 'with auto-approve on, a request is approved straight away');
select throws_ok($$select public.submit_registration('gen@example.test','Gen','a3000000-0000-0000-0000-000000000003',null)$$, '22023', null,
  'with the general page off, picking a place is refused');

-- turning a link off
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(public.set_unit_signup('a3000000-0000-0000-0000-000000000004', false), null, 'admin turns the S2 link off');
reset role;
select is((select signup_code from public.units where id = 'a3000000-0000-0000-0000-000000000004'), null, 'S2 has no link now');

-- ------------------------------------------------------- notes and roles (round two)
-- back to approval mode, with the general page on
update public.app_settings set value = 'off' where key = 'registration_auto_approve';
update public.app_settings set value = 'on' where key = 'registration_general';

select is(public.submit_registration('noted@example.test', 'Noted', 'a3000000-0000-0000-0000-000000000003', null, '  Started Monday, on nights  ') ->> 'status',
  'pending', 'a request can carry a note');
select is((select note from public.registration_requests where email = 'noted@example.test'), 'Started Monday, on nights', 'the note is trimmed and kept');
select throws_ok($$select public.submit_registration('long@example.test','L','a3000000-0000-0000-0000-000000000003',null, repeat('x', 501))$$,
  '22023', null, 'a note over 500 characters is refused');
select is(public.submit_registration('boss@example.test', 'Would be boss', 'a3000000-0000-0000-0000-000000000003', null) ->> 'status',
  'pending', 'second request for S1');
update public.registration_requests set id = 'f3000000-0000-0000-0000-000000000003' where email = 'noted@example.test';
update public.registration_requests set id = 'f3000000-0000-0000-0000-000000000004' where email = 'boss@example.test';

-- a manager whose scope is the brand (above S1) and one whose scope is S1 itself
insert into auth.users (id, email) values ('b3000000-0000-0000-0000-000000000006', 'brandmgr@sr.test');
update public.users set role='manager', is_approver=true, unit_id='a3000000-0000-0000-0000-000000000002' where id='b3000000-0000-0000-0000-000000000006';
insert into public.user_scopes (user_id, unit_id) values ('b3000000-0000-0000-0000-000000000006', 'a3000000-0000-0000-0000-000000000002');

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select note from public.pending_registrations() where id = 'f3000000-0000-0000-0000-000000000003'), 'Started Monday, on nights', 'approvers see the note');
select is((select role_choices from public.pending_registrations() where id = 'f3000000-0000-0000-0000-000000000003'), array['learner'],
  'an S1 manager can only approve S1 people as learners (no peer managers)');
select throws_ok($$select public.decide_registration('f3000000-0000-0000-0000-000000000004', true, null, 'manager')$$,
  '42501', 'registration: role not allowed', 'and is refused if they try manager');
reset role;

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select is((select role_choices from public.pending_registrations() where id = 'f3000000-0000-0000-0000-000000000004'), array['learner','viewer','manager'],
  'a brand manager can make an S1 person a viewer or manager');
reset role;

-- the login made for the request (as the route would, after the request)
insert into auth.users (id, email) values ('b3000000-0000-0000-0000-000000000007', 'boss@example.test');
update public.users set unit_id = 'a3000000-0000-0000-0000-000000000003' where id = 'b3000000-0000-0000-0000-000000000007';

select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select is(public.decide_registration('f3000000-0000-0000-0000-000000000004', true, 'b3000000-0000-0000-0000-000000000007', 'manager') ->> 'role_applied',
  'true', 'brand manager approves them as a manager');
reset role;
select is((select role from public.users where id = 'b3000000-0000-0000-0000-000000000007'), 'manager', 'the new login is a manager');
select is((select array_agg(unit_id) from public.user_scopes where user_id = 'b3000000-0000-0000-0000-000000000007'),
  array['a3000000-0000-0000-0000-000000000003'::uuid], 'and sees their own place');

-- an existing login never has its role changed by approval
update public.registration_requests set created_at = now() + interval '1 hour' where id = 'f3000000-0000-0000-0000-000000000003';
insert into auth.users (id, email) values ('b3000000-0000-0000-0000-000000000008', 'noted@example.test');
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(public.decide_registration('f3000000-0000-0000-0000-000000000003', true, 'b3000000-0000-0000-0000-000000000008', 'admin') ->> 'role_applied',
  'false', 'a login older than the request keeps its role');
reset role;
select is((select role from public.users where id = 'b3000000-0000-0000-0000-000000000008'), 'learner', 'still a learner');
select ok(not has_function_privilege('anon', 'public.registration_role_choices(uuid)', 'execute'), 'anon cannot ask about roles');

-- ------------------------------------------------------- privileges
select ok(not has_function_privilege('authenticated', 'public.submit_registration(text,text,uuid,text,text)', 'execute'), 'only the service role submits');
select ok(not has_function_privilege('authenticated', 'public.registration_approvers(uuid)', 'execute'), 'approver emails are service role only');
select ok(not has_function_privilege('anon', 'public.pending_registrations()', 'execute'), 'anon cannot list requests');
select ok(has_function_privilege('anon', 'public.registration_options(text)', 'execute'), 'anon can load the sign-up page');

select * from finish();
rollback;
