-- CMP Final SQL (RLS + Locks + Help + Leaderboard)
-- Run in Supabase SQL Editor.

-- 0) (Optional) Unique constraints to support UPSERTs
alter table public.predictions
  add constraint if not exists predictions_unique
  unique (user_id, contest_code, round, match_id);

alter table public.user_round_locks
  add constraint if not exists user_round_locks_unique
  unique (user_id, contest_code, round);

alter table public.help_purchases
  add constraint if not exists help_purchases_unique
  unique (user_id, contest_code);

-- 1) match_results (if you don't already have it)
create table if not exists public.match_results (
  contest_code text not null,
  round integer not null,
  match_id text not null,
  result text check (result in ('1','X','2')),
  -- ✅ OFF match should not count towards scoring/bonus
  is_off boolean not null default false,
  home_ft integer,
  away_ft integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contest_code, round, match_id)
);

-- ensure column exists if table was created earlier
alter table public.match_results
  add column if not exists is_off boolean not null default false;

-- 2) RLS: predictions (read own, write own if NOT locked)
alter table public.predictions enable row level security;

drop policy if exists "pred_select_own" on public.predictions;
create policy "pred_select_own"
on public.predictions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "pred_insert_if_not_locked" on public.predictions;
create policy "pred_insert_if_not_locked"
on public.predictions
for insert
to authenticated
with check (
  auth.uid() = user_id
  and not exists (
    select 1
    from public.user_round_locks l
    where l.user_id = auth.uid()
      and l.contest_code = predictions.contest_code
      and l.round = predictions.round
      and l.locked = true
  )
);

drop policy if exists "pred_update_if_not_locked" on public.predictions;
create policy "pred_update_if_not_locked"
on public.predictions
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and not exists (
    select 1
    from public.user_round_locks l
    where l.user_id = auth.uid()
      and l.contest_code = predictions.contest_code
      and l.round = predictions.round
      and l.locked = true
  )
);

-- 3) RLS: user_round_locks (read/insert/update own)
alter table public.user_round_locks enable row level security;

drop policy if exists "locks_select_own" on public.user_round_locks;
create policy "locks_select_own"
on public.user_round_locks
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "locks_insert_own" on public.user_round_locks;
create policy "locks_insert_own"
on public.user_round_locks
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "locks_update_own" on public.user_round_locks;
create policy "locks_update_own"
on public.user_round_locks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 4) RLS: help_purchases (read/insert/update own)
alter table public.help_purchases enable row level security;

drop policy if exists "help_select_own" on public.help_purchases;
create policy "help_select_own"
on public.help_purchases
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "help_upsert_own" on public.help_purchases;
create policy "help_upsert_own"
on public.help_purchases
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 5) RLS: match_results (read all logged-in; write admin only)
alter table public.match_results enable row level security;

drop policy if exists "match_results_read" on public.match_results;
create policy "match_results_read"
on public.match_results
for select
to authenticated
using (true);

drop policy if exists "match_results_admin_write" on public.match_results;
create policy "match_results_admin_write"
on public.match_results
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- 6) Leaderboard views (1 point per correct; BONUS +2 if all correct in a round; HELP counts as correct; OFF excluded)

-- Per-contest leaderboard (what you show for the active contest)
create or replace view public.leaderboard_contest_v as
with eligible as (
  -- Matches that count for normal scoring/bonus (ON + have final result)
  select contest_code, round, match_id, result
  from public.match_results
  where result is not null
    and coalesce(is_off,false) = false
),
per_round as (
  select
    e.contest_code,
    p.user_id,
    e.round,
    count(*) as total_matches,
    count(*) filter (where p.id is not null) as user_preds,
    sum(
      case
        when p.id is null then 0
        when p.pick = e.result then 1
        when p.pick = 'HELP' then 1
        else 0
      end
    ) as correct
  from eligible e
  left join public.predictions p
    on p.contest_code = e.contest_code
   and p.round = e.round
   and p.match_id = e.match_id
  group by e.contest_code, p.user_id, e.round
),
help_off as (
  -- OFF matches: if the user used HELP, they keep +1 point (matches your current admin.js)
  select
    r.contest_code,
    p.user_id,
    count(*)::int as help_off_points
  from public.match_results r
  join public.predictions p
    on p.contest_code = r.contest_code
   and p.round = r.round
   and p.match_id = r.match_id
  where coalesce(r.is_off,false) = true
    and p.pick = 'HELP'
  group by r.contest_code, p.user_id
),
scored as (
  select
    contest_code,
    user_id,
    sum(correct)::int as correct_points,
    sum(
      case
        when total_matches > 0
         and user_id is not null
         and user_preds = total_matches
         and correct = total_matches
        then 2 else 0
      end
    )::int as bonus_points
  from per_round
  where user_id is not null
  group by contest_code, user_id
)
select
  s.contest_code,
  s.user_id,
  (s.correct_points + coalesce(h.help_off_points,0))::int as correct_predictions,
  s.bonus_points,
  (s.correct_points + coalesce(h.help_off_points,0) + s.bonus_points)::int as points
from scored s
left join help_off h
  on h.contest_code = s.contest_code
 and h.user_id = s.user_id;

-- Total leaderboard across all contests (optional "general total")
create or replace view public.leaderboard_total_v as
select
  user_id,
  sum(points)::int as total_points
from public.leaderboard_contest_v
group by user_id;

grant select on public.leaderboard_contest_v to anon, authenticated;
grant select on public.leaderboard_total_v to anon, authenticated;
