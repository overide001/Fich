-- 002_player_accounts.sql
-- Anonymous device-ID accounts + persistent player wallets.
--
-- Why RLS is enabled with NO policies on both tables:
--   The browser client is never allowed to touch these tables directly.
--   All reads/writes go through the server process using the service-role
--   key (or a direct Postgres connection with the service role), which
--   BYPASSES row level security. Enabling RLS without any policies means
--   an anon / authenticated Supabase client sees zero rows and can insert
--   nothing, while the server still has full access. This mirrors the
--   rationale in 001_multiplayer.sql for the `runs` table.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  device_id text unique,
  email text unique,
  password_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.player_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  coins integer not null default 0,
  skins text[] not null default array['default'],
  active_skin text not null default 'default',
  upgrades jsonb not null default '{"startStage":0,"extraEnergy":0,"growthBoost":0,"coinMult":0}'::jsonb,
  best jsonb not null default '{"time":0,"kills":0,"size":0,"coins":0}'::jsonb,
  total_kills integer not null default 0,
  total_runs integer not null default 0,
  total_coins_earned integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists player_profiles_updated_idx on public.player_profiles (updated_at desc);

alter table public.users enable row level security;
alter table public.player_profiles enable row level security;
-- No public policies: only the server-side service-role key (which bypasses RLS) may read/write.