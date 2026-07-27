-- ============================================================
-- 2x5 Strong — Baseline Schema
-- This migration represents the full initial state of the DB.
-- All subsequent changes are in separate migration files.
-- ============================================================

-- Enable UUID extension

-- ── Profiles ─────────────────────────────────────────────────
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text not null,
  color text not null default '#e8d44d',
  next_workout char(1) not null default 'A',
  created_at timestamptz default now()
);

alter table profiles enable row level security;

drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- ── Lift States ───────────────────────────────────────────────
create table if not exists lift_states (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  lift_id text not null,
  weight numeric(6,2) not null default 45,
  failures int not null default 0,
  deloads int not null default 0,
  updated_at timestamptz default now(),
  unique(user_id, lift_id)
);

alter table lift_states enable row level security;

drop policy if exists "Users can manage own lift states" on lift_states;
create policy "Users can manage own lift states"
  on lift_states for all using (auth.uid() = user_id);

-- ── Sessions ──────────────────────────────────────────────────
create table if not exists sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  workout_day char(1) not null,
  completed_at timestamptz default now()
);

alter table sessions enable row level security;

drop policy if exists "Users can manage own sessions" on sessions;
create policy "Users can manage own sessions"
  on sessions for all using (auth.uid() = user_id);

-- ── Session Lifts ─────────────────────────────────────────────
create table if not exists session_lifts (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references sessions(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  lift_id text not null,
  lift_name text not null,
  weight numeric(6,2) not null,
  sets_json jsonb not null default '[]',
  sets_passed int not null default 0
);

alter table session_lifts enable row level security;

drop policy if exists "Users can manage own session lifts" on session_lifts;
create policy "Users can manage own session lifts"
  on session_lifts for all using (auth.uid() = user_id);

-- ── Auto-create profile on signup ─────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'color', '#e8d44d')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
