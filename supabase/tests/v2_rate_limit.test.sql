-- Shared rate limit: counts per key per window, refuses over the limit, keeps
-- keys apart, rejects bad input, and is unreachable by anon and learners.
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

select ok(public.hit_rate_limit('t:a', 3), 'hit 1 allowed');
select ok(public.hit_rate_limit('t:a', 3), 'hit 2 allowed');
select ok(public.hit_rate_limit('t:a', 3), 'hit 3 allowed');
select ok(not public.hit_rate_limit('t:a', 3), 'hit 4 refused');
select ok(not public.hit_rate_limit('t:a', 3), 'still refused');
select ok(public.hit_rate_limit('t:b', 3), 'a different key has its own count');
select is((select hits from public.rate_limit_hits where key = 't:a'), 5, 'every hit is counted, even refused ones');

select throws_ok($$select public.hit_rate_limit('', 3)$$, 'P0001', 'invalid rate limit key', 'empty key rejected');
select throws_ok($$select public.hit_rate_limit('k', 0)$$, 'P0001', 'invalid rate limit settings', 'zero limit rejected');

select ok(not has_function_privilege('anon', 'public.hit_rate_limit(text, integer, integer)', 'execute'), 'anon cannot call it');
select ok(not has_function_privilege('authenticated', 'public.hit_rate_limit(text, integer, integer)', 'execute'), 'learners cannot call it');
select ok(not has_table_privilege('authenticated', 'public.rate_limit_hits', 'select'), 'learners cannot read the counts');

select * from finish();
rollback;
