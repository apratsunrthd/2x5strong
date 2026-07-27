-- Accessory exercises — user's custom exercise library
create table if not exists accessory_exercises (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  category text not null default 'Other',
  exercise_type text not null default 'standard',
  created_at timestamptz default now()
);

alter table accessory_exercises enable row level security;

drop policy if exists "Users can manage own accessory exercises" on accessory_exercises;
create policy "Users can manage own accessory exercises"
  on accessory_exercises for all using (auth.uid() = user_id);

-- Accessory logs — accessories done within a session
create table if not exists accessory_logs (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references sessions(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  exercise_name text not null,
  exercise_type text not null default 'standard',
  category text not null default 'Other',
  sets_json jsonb not null default '[]',
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table accessory_logs enable row level security;

drop policy if exists "Users can manage own accessory logs" on accessory_logs;
create policy "Users can manage own accessory logs"
  on accessory_logs for all using (auth.uid() = user_id);
