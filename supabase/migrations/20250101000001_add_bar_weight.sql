-- Add bar_weight column to lift_states
-- Allows per-lift bar weight configuration (standard 45lb, women's 35lb, technique 15lb)
alter table lift_states
  add column if not exists bar_weight numeric(6,2) not null default 45;
