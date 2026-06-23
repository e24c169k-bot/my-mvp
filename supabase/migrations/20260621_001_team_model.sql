-- Team model + game state columns
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'coach', 'member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table seasons add column if not exists team_id uuid references teams(id) on delete cascade;
alter table players add column if not exists team_id uuid references teams(id) on delete cascade;
alter table games add column if not exists team_id uuid references teams(id) on delete cascade;
alter table lineups add column if not exists team_id uuid references teams(id) on delete cascade;
alter table pitches add column if not exists team_id uuid references teams(id) on delete cascade;
alter table plate_appearances add column if not exists team_id uuid references teams(id) on delete cascade;
alter table runner_advances add column if not exists team_id uuid references teams(id) on delete cascade;
alter table stats add column if not exists team_id uuid references teams(id) on delete cascade;

alter table games add column if not exists state_json jsonb not null default '{}'::jsonb;

create index if not exists idx_team_members_user_id on team_members(user_id);
create index if not exists idx_seasons_team_id on seasons(team_id);
create index if not exists idx_players_team_id on players(team_id);
create index if not exists idx_games_team_id on games(team_id);
create index if not exists idx_lineups_team_id on lineups(team_id);
create index if not exists idx_pitches_team_id on pitches(team_id);
create index if not exists idx_pa_team_id on plate_appearances(team_id);
create index if not exists idx_runner_adv_team_id on runner_advances(team_id);
create index if not exists idx_stats_team_id on stats(team_id);
