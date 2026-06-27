-- Fix infinite recursion in team_members RLS policies.
-- Cause: policy conditions referencing team_members itself.

drop policy if exists team_members_owner_manage on team_members;
drop policy if exists team_members_bootstrap_insert on team_members;
drop policy if exists team_members_self_read on team_members;

create policy team_members_self_read on team_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from teams t
    where t.id = team_members.team_id
      and t.created_by = auth.uid()
  )
);

create policy team_members_insert_owner_or_self on team_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from teams t
    where t.id = team_members.team_id
      and t.created_by = auth.uid()
  )
);

create policy team_members_update_owner_only on team_members
for update
to authenticated
using (
  exists (
    select 1
    from teams t
    where t.id = team_members.team_id
      and t.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from teams t
    where t.id = team_members.team_id
      and t.created_by = auth.uid()
  )
);

create policy team_members_delete_owner_only on team_members
for delete
to authenticated
using (
  exists (
    select 1
    from teams t
    where t.id = team_members.team_id
      and t.created_by = auth.uid()
  )
);
