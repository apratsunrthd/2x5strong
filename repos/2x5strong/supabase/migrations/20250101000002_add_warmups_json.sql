-- Add warmups_json to session_lifts
-- Stores completed warmup sets { weight, reps, done } for volume tracking
alter table session_lifts
  add column if not exists warmups_json jsonb not null default '[]';
