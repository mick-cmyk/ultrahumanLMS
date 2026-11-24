-- Welcome page wording: anyone can read it (the page is public), only admins
-- can change it, the shape and house style are enforced, and null puts the
-- brand file's wording back.
begin;
select * from no_plan();

insert into public.units (id, parent_id, kind, name) values
 ('a7000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', 'store', 'S1');
insert into auth.users (id, email) values
 ('b7000000-0000-0000-0000-000000000001', 'admin@st.test'),
 ('b7000000-0000-0000-0000-000000000002', 'manager@st.test'),
 ('b7000000-0000-0000-0000-000000000003', 'floor@st.test');
update public.users set role='admin', unit_id='a7000000-0000-0000-0000-000000000001' where id='b7000000-0000-0000-0000-000000000001';
update public.users set role='manager', unit_id='a7000000-0000-0000-0000-000000000002' where id='b7000000-0000-0000-0000-000000000002';
update public.users set unit_id='a7000000-0000-0000-0000-000000000002' where id='b7000000-0000-0000-0000-000000000003';
insert into public.user_scopes (user_id, unit_id) values ('b7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000002');

create temp table good as select '{
  "heading": "Welcome",
  "intro": ["One.", "Two."],
  "steps": [{"title": "Watch", "body": "A video."}],
  "newHere": "New here?",
  "websitePrompt": "",
  "websiteLinkText": ""
}'::jsonb as v;
grant select on good to anon, authenticated;

-- nothing saved yet: the public sees null (use the brand file)
set local role anon;
select is(public.welcome_text(), null, 'no saved wording to start with');
select throws_ok($$select public.set_welcome_text((select v from good))$$, '42501', null, 'the public cannot save');
select throws_ok($$select * from public.site_text$$, '42501', null, 'the table is not readable directly');
reset role;

-- learners and managers cannot save
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$select public.set_welcome_text((select v from good))$$, '42501', null, 'a learner cannot save');
reset role;
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select public.set_welcome_text((select v from good))$$, '42501', null, 'a manager cannot save');
select throws_ok($$update public.site_text set welcome = null$$, '42501', null, 'nor write the table directly');
reset role;

-- an admin saves, and everyone sees it
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.set_welcome_text((select v from good))$$, 'an admin saves');
select lives_ok($$select public.set_welcome_text((select v || '{"heading":"Hello"}' from good))$$, 'and saves again');
reset role;
set local role anon;
select is(public.welcome_text()->>'heading', 'Hello', 'the public sees the latest wording');
reset role;
select is((select count(*) from public.site_text), 1::bigint, 'still one row');
select is((select updated_by from public.site_text), 'b7000000-0000-0000-0000-000000000001'::uuid, 'who changed it is recorded');

-- bad shapes are refused
select set_config('request.jwt.claim.sub','b7000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$select public.set_welcome_text((select v || '{"heading":"  "}' from good))$$, '23514', null, 'an empty heading is refused');
select throws_ok($$select public.set_welcome_text((select v || jsonb_build_object('heading', 'A ' || chr(8212) || ' B') from good))$$, '23514', null, 'an em dash is refused');
select throws_ok($$select public.set_welcome_text((select v || '{"intro":["a","b","c","d","e","f"]}' from good))$$, '23514', null, 'more than five paragraphs is refused');
select throws_ok($$select public.set_welcome_text((select v || '{"steps":[{"title":"x"}]}' from good))$$, '23514', null, 'a step without a body is refused');
select throws_ok($$select public.set_welcome_text((select v || '{"extra":"x"}' from good))$$, '23514', null, 'unknown keys are refused');
select throws_ok($$select public.set_welcome_text((select v - 'newHere' from good))$$, '23514', null, 'a missing field is refused');
select throws_ok($$select public.set_welcome_text('"just text"'::jsonb)$$, '23514', null, 'a non-object is refused');

-- reset to the brand file
select lives_ok($$select public.set_welcome_text(null)$$, 'an admin resets to the default');
reset role;
select is(public.welcome_text(), null, 'and the default is back');

select * from finish();
rollback;
