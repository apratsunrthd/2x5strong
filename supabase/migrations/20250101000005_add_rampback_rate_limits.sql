-- ============================================================
-- Ramp-back rate limiting — protects generate-rampback-plan from
-- uncapped Anthropic API spend once it starts getting public traffic
-- (see docs/designs/graduate-from-stronglifts-positioning.md, step 0).
--
-- Both tables are RLS-enabled with NO policies for authenticated/anon
-- roles. That's deliberate, not an oversight: a rate-limit counter must
-- never be client-writable, or a user could edit their own row to
-- bypass the cap (the mistake this migration exists to avoid — see the
-- design doc's callout that lift_states' "auth.uid() = user_id" policy
-- shape does NOT apply here). Only the service role, used exclusively
-- from inside the generate-rampback-plan edge function, can read or
-- write these tables.
-- ============================================================

create table if not exists rampback_request_counts (
  user_id uuid references profiles(id) on delete cascade not null,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

alter table rampback_request_counts enable row level security;
-- No policies: RLS enabled + zero policies denies all access to
-- authenticated/anon roles. Service role bypasses RLS entirely.

create table if not exists rampback_daily_spend (
  day date primary key,
  spend_usd numeric(10,4) not null default 0
);

alter table rampback_daily_spend enable row level security;
-- No policies — same reasoning as above.
