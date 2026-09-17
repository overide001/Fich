-- Run this in the Supabase SQL editor before enabling server persistence.
create table if not exists public.runs (
  id bigint generated always as identity primary key,
  room_id text not null,
  player_id text not null,
  lineage text not null,
  kills integer not null default 0,
  size numeric not null,
  duration_seconds integer not null,
  created_at timestamptz not null default now()
);

create index if not exists runs_duration_idx on public.runs (duration_seconds desc);
create index if not exists runs_kills_idx on public.runs (kills desc);

-- The service-role key used by the game server bypasses RLS. Browser clients
-- receive no write policy, so score submissions cannot be forged from DevTools.
alter table public.runs enable row level security;
