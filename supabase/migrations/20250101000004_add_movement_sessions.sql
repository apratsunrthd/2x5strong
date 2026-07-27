-- Movement sessions — AI-generated lighter workout days
create table if not exists movement_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null default 'Movement Day',
  tagline text,
  prompt_used text,
  completed_at timestamptz default now()
);

alter table movement_sessions enable row level security;

drop policy if exists "Users can manage own movement sessions" on movement_sessions;
create policy "Users can manage own movement sessions"
  on movement_sessions for all using (auth.uid() = user_id);

-- Movement session exercises — individual exercises within a movement session
create table if not exists movement_session_exercises (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references movement_sessions(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  category text not null default 'Other',
  weight numeric(6,2) not null default 0,
  prescription text not null default '10-12',
  sets_json jsonb not null default '[]',
  sort_order int not null default 0
);

alter table movement_session_exercises enable row level security;

drop policy if exists "Users can manage own movement session exercises" on movement_session_exercises;
create policy "Users can manage own movement session exercises"
  on movement_session_exercises for all using (auth.uid() = user_id);
