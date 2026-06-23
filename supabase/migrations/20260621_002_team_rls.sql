-- Enable RLS for all relevant tables.
alter table teams enable row level security;
alter table team_members enable row level security;
alter table seasons enable row level security;
alter table players enable row level security;
alter table games enable row level security;
alter table lineups enable row level security;
alter table pitches enable row level security;
alter table plate_appearances enable row level security;
alter table runner_advances enable row level security;
alter table stats enable row level security;

-- Helper predicate pattern:
-- user can access row when row.team_id is one of user's memberships.

drop policy if exists team_members_self_read on team_members;
create policy team_members_self_read on team_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists team_members_owner_manage on team_members;
create policy team_members_owner_manage on team_members
for all
to authenticated
using (
  exists (
    select 1
    from team_members tm
    where tm.team_id = team_members.team_id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  )
)
with check (
  exists (
    select 1
    from team_members tm
    where tm.team_id = team_members.team_id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  )
);

drop policy if exists team_members_bootstrap_insert on team_members;
create policy team_members_bootstrap_insert on team_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from teams t
    where t.id = team_members.team_id
      and t.created_by = auth.uid()
  )
);

drop policy if exists teams_member_read on teams;
create policy teams_member_read on teams
for select
to authenticated
using (
  exists (
    select 1
    from team_members tm
    where tm.team_id = teams.id
      and tm.user_id = auth.uid()
  )
);

drop policy if exists teams_create_self on teams;
create policy teams_create_self on teams
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists teams_owner_manage on teams;
create policy teams_owner_manage on teams
for update
to authenticated
using (
  exists (
    select 1
    from team_members tm
    where tm.team_id = teams.id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  )
)
with check (
  exists (
    select 1
    from team_members tm
    where tm.team_id = teams.id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  )
);

drop policy if exists teams_owner_delete on teams;
create policy teams_owner_delete on teams
for delete
to authenticated
using (
  exists (
    select 1
    from team_members tm
    where tm.team_id = teams.id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  )
);

-- Generic team-bound policies
drop policy if exists seasons_team_access on seasons;
create policy seasons_team_access on seasons
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = seasons.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = seasons.team_id and tm.user_id = auth.uid()
  )
);

drop policy if exists players_team_access on players;
create policy players_team_access on players
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = players.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = players.team_id and tm.user_id = auth.uid()
  )
);

drop policy if exists games_team_access on games;
create policy games_team_access on games
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = games.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = games.team_id and tm.user_id = auth.uid()
  )
);

drop policy if exists lineups_team_access on lineups;
create policy lineups_team_access on lineups
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = lineups.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = lineups.team_id and tm.user_id = auth.uid()
  )
);

drop policy if exists pitches_team_access on pitches;
create policy pitches_team_access on pitches
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = pitches.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = pitches.team_id and tm.user_id = auth.uid()
  )
);

drop policy if exists pa_team_access on plate_appearances;
create policy pa_team_access on plate_appearances
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = plate_appearances.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = plate_appearances.team_id and tm.user_id = auth.uid()
  )
);

drop policy if exists runner_adv_team_access on runner_advances;
create policy runner_adv_team_access on runner_advances
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = runner_advances.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = runner_advances.team_id and tm.user_id = auth.uid()
  )
);

drop policy if exists stats_team_access on stats;
create policy stats_team_access on stats
for all
to authenticated
using (
  exists (
    select 1 from team_members tm
    where tm.team_id = stats.team_id and tm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from team_members tm
    where tm.team_id = stats.team_id and tm.user_id = auth.uid()
  )
);
