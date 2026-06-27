create or replace function public.calc_game_stats(p_game_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
  ) then
    raise exception 'not authorized for team';
  end if;

  delete from stats
  where game_id = p_game_id
    and team_id = p_team_id;

  insert into stats (
    game_id, team_id, player_id, type,
    at_bats, hits, doubles, triples, home_runs, walks, hit_by_pitch,
    avg, obp, slg, ops
  )
  select
    pa.game_id,
    p_team_id,
    pa.player_id,
    'batting',
    sum(case when pa.result in ('四球', '申告敬遠', 'デッドボール', 'バント', '打撃妨害') then 0 else 1 end),
    sum(case when pa.result in ('ヒット', '2B', '3B', 'HR', '走HR', 'エン2B') then 1 else 0 end),
    sum(case when pa.result in ('2B', 'エン2B') then 1 else 0 end),
    sum(case when pa.result = '3B' then 1 else 0 end),
    sum(case when pa.result in ('HR', '走HR') then 1 else 0 end),
    sum(case when pa.result in ('四球', '申告敬遠') then 1 else 0 end),
    sum(case when pa.result = 'デッドボール' then 1 else 0 end),
    0, 0, 0, 0
  from plate_appearances pa
  where pa.game_id = p_game_id
    and pa.team_id = p_team_id
    and pa.player_id is not null
  group by pa.game_id, pa.player_id;

  update stats s
  set
    avg = case when s.at_bats > 0 then round((s.hits::numeric / s.at_bats::numeric), 3) else 0 end,
    obp = case when (s.at_bats + s.walks + s.hit_by_pitch) > 0
      then round(((s.hits + s.walks + s.hit_by_pitch)::numeric / (s.at_bats + s.walks + s.hit_by_pitch)::numeric), 3)
      else 0 end,
    slg = case when s.at_bats > 0
      then round((((s.hits - s.doubles - s.triples - s.home_runs) + s.doubles * 2 + s.triples * 3 + s.home_runs * 4)::numeric / s.at_bats::numeric), 3)
      else 0 end,
    ops = case when s.at_bats > 0
      then round((
        (((s.hits + s.walks + s.hit_by_pitch)::numeric / nullif((s.at_bats + s.walks + s.hit_by_pitch), 0)::numeric))
        +
        ((((s.hits - s.doubles - s.triples - s.home_runs) + s.doubles * 2 + s.triples * 3 + s.home_runs * 4)::numeric / nullif(s.at_bats, 0)::numeric))
      ), 3)
      else 0 end
  where s.game_id = p_game_id
    and s.team_id = p_team_id
    and s.type = 'batting';

  insert into stats (
    game_id, team_id, player_id, type,
    innings_pitched, strikeouts, walks, hit_by_pitch, earned_runs, era, bb_per9
  )
  select
    p.game_id,
    p_team_id,
    p.pitcher_id,
    'pitching',
    round((sum(case when p.result = 'TP' then 3 when p.result = 'DP' then 2 when p.result in ('ゴロアウト','フライアウト','ライナーアウト','バント','三振') then 1 else 0 end)::numeric / 3.0), 1),
    sum(case when p.result = '三振' then 1 else 0 end),
    sum(case when p.result in ('四球','申告敬遠') then 1 else 0 end),
    sum(case when p.result = 'デッドボール' then 1 else 0 end),
    0,
    0,
    0
  from pitches p
  where p.game_id = p_game_id
    and p.team_id = p_team_id
    and p.pitcher_id is not null
  group by p.game_id, p.pitcher_id;

  update stats s
  set
    earned_runs = er.earned_runs,
    era = case
      when s.innings_pitched > 0 then round((er.earned_runs::numeric * 7.0) / s.innings_pitched, 2)
      else 0
    end,
    bb_per9 = case
      when s.innings_pitched > 0 then round((s.walks::numeric * 9.0) / s.innings_pitched, 2)
      else 0
    end
  from (
    select
      p.pitcher_id,
      count(*)::integer as earned_runs
    from runner_advances ra
    join pitches p on p.id = ra.pitch_id
    where p.game_id = p_game_id
      and p.team_id = p_team_id
      and ra.team_id = p_team_id
      and ra.to_base = '本塁'
      and coalesce(ra.reason, '') not in ('エラー・野選', 'パスボール', '打撃妨害')
    group by p.pitcher_id
  ) er
  where s.game_id = p_game_id
    and s.team_id = p_team_id
    and s.type = 'pitching'
    and s.player_id = er.pitcher_id;

  update stats s
  set
    earned_runs = 0,
    era = 0,
    bb_per9 = case
      when s.innings_pitched > 0 then round((s.walks::numeric * 9.0) / s.innings_pitched, 2)
      else 0
    end
  where s.game_id = p_game_id
    and s.team_id = p_team_id
    and s.type = 'pitching'
    and not exists (
      select 1 from runner_advances ra
      join pitches p on p.id = ra.pitch_id
      where p.game_id = p_game_id
        and p.team_id = p_team_id
        and p.pitcher_id = s.player_id
        and ra.team_id = p_team_id
        and ra.to_base = '本塁'
        and coalesce(ra.reason, '') not in ('エラー・野選', 'パスボール', '打撃妨害')
    );

  update games
  set status = 'finished'
  where id = p_game_id
    and team_id = p_team_id;
end;
$$;
