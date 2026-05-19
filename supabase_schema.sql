-- ============================================================
-- 2x5 STRONG — Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension (usually already enabled)
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES
-- One row per user, created on signup
-- ============================================================
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text not null,
  color text not null default '#e8d44d',
  next_workout char(1) not null default 'A',
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- ============================================================
-- LIFT STATES
-- Current weight, failure count, deload count per lift per user
-- ============================================================
create table if not exists lift_states (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  lift_id text not null,
  weight numeric(6,2) not null default 45,
  bar_weight numeric(6,2) not null default 45,
  failures int not null default 0,
  deloads int not null default 0,
  updated_at timestamptz default now(),
  unique(user_id, lift_id)
);


-- ── v0.3 migration: if you ran schema before v0.3, run this in SQL Editor:
-- alter table lift_states add column if not exists bar_weight numeric(6,2) not null default 45;
alter table lift_states enable row level security;

create policy "Users can manage own lift states"
  on lift_states for all using (auth.uid() = user_id);

-- ============================================================
-- SESSIONS
-- One row per completed workout session
-- ============================================================
create table if not exists sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  workout_day char(1) not null,
  completed_at timestamptz default now()
);

alter table sessions enable row level security;

create policy "Users can manage own sessions"
  on sessions for all using (auth.uid() = user_id);

-- ============================================================
-- SESSION LIFTS
-- Individual lift results within a session
-- ============================================================
create table if not exists session_lifts (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references sessions(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  lift_id text not null,
  lift_name text not null,
  weight numeric(6,2) not null,
  sets_json jsonb not null default '[]',
  sets_passed int not null default 0,
  warmups_json jsonb not null default '[]'
);


-- ── v0.4 migration: if you ran schema before v0.4, run this in SQL Editor:
-- alter table session_lifts add column if not exists warmups_json jsonb not null default '[]';
alter table session_lifts enable row level security;

create policy "Users can manage own session lifts"
  on session_lifts for all using (auth.uid() = user_id);

-- ============================================================
-- FUNCTION: auto-create profile row on signup
-- ============================================================
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

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- SEED DEFAULT LIFT STATES (called from app on first login)
-- Not needed as SQL — handled in JS — but listed for reference:
-- lift_ids: squat, bench, row, press, deadlift
-- all start at 45lb
-- ============================================================
