-- 0002: transactional change/commit RPCs, overbooking guard, usage stats.

create or replace function assert_no_overbooking(p_cycle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select case when mode = 'simultaneous' then max_simultaneous else 1 end into lim from cycles where id = p_cycle;
  if exists (select 1 from assignments where cycle_id = p_cycle group by slot_id, cycle_team_id having count(*) > lim) then
    raise exception 'team overbooked: more than % mentors in a slot', lim;
  end if;
end $$;

-- Applies one availability/status change AND the resulting assignment diff atomically.
-- Callable by admins (any change) and by mentors (only their own absence/break changes).
-- p_change examples:
--   {"type":"mentor_unavailable","cycle_mentor_id":"..","slot_ids":[".."],"reason":"absent|break"}
--   {"type":"mentor_available","cycle_mentor_id":"..","slot_ids":[".."]}
--   {"type":"mentor_status","cycle_mentor_id":"..","status":"active|absent|removed"}
--   {"type":"team_unavailable|team_available","cycle_team_id":"..","slot_ids":[..]}
--   {"type":"team_status","cycle_team_id":"..","status":".."}
--   {"type":"slot_toggle","slot_id":"..","enabled":true}
--   {"type":"slot_kind","slot_id":"..","kind":"session|break"}
--   {"type":"manual"}            -- only p_remove / p_add used
--   {"type":"regenerate"}        -- only p_remove / p_add used
-- p_add rows: [{slot_id, cycle_mentor_id, cycle_team_id, locked?}]
create or replace function commit_change(p_cycle uuid, p_change jsonb, p_remove uuid[], p_add jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  t text := p_change->>'type';
  admin boolean := is_admin() or auth.role() = 'service_role';
  cm uuid; n int;
begin
  if t in ('mentor_unavailable','mentor_available') then
    cm := (p_change->>'cycle_mentor_id')::uuid;
    if not admin and not (cm in (select my_cycle_mentor_ids())) then raise exception 'forbidden'; end if;
    if not exists (select 1 from cycle_mentors where id = cm and cycle_id = p_cycle) then raise exception 'unknown mentor'; end if;
    if t = 'mentor_unavailable' then
      insert into mentor_availability(cycle_mentor_id, slot_id, reason, requested_by)
      select cm, s::uuid, coalesce(p_change->>'reason','absent'), auth.uid()
      from jsonb_array_elements_text(p_change->'slot_ids') s
      where exists (select 1 from time_slots ts where ts.id = s::uuid and ts.cycle_id = p_cycle)
      on conflict (cycle_mentor_id, slot_id) do update set reason = excluded.reason;
    else
      delete from mentor_availability where cycle_mentor_id = cm
        and slot_id in (select s::uuid from jsonb_array_elements_text(p_change->'slot_ids') s);
    end if;
  elsif not admin then
    raise exception 'forbidden';
  elsif t = 'mentor_status' then
    update cycle_mentors set status = (p_change->>'status')::member_status
      where id = (p_change->>'cycle_mentor_id')::uuid and cycle_id = p_cycle;
  elsif t = 'team_status' then
    update cycle_teams set status = (p_change->>'status')::member_status
      where id = (p_change->>'cycle_team_id')::uuid and cycle_id = p_cycle;
  elsif t = 'team_unavailable' then
    insert into team_availability(cycle_team_id, slot_id)
    select (p_change->>'cycle_team_id')::uuid, s::uuid from jsonb_array_elements_text(p_change->'slot_ids') s
    where exists (select 1 from time_slots ts where ts.id = s::uuid and ts.cycle_id = p_cycle)
    on conflict do nothing;
  elsif t = 'team_available' then
    delete from team_availability where cycle_team_id = (p_change->>'cycle_team_id')::uuid
      and slot_id in (select s::uuid from jsonb_array_elements_text(p_change->'slot_ids') s);
  elsif t = 'slot_toggle' then
    update time_slots set enabled = (p_change->>'enabled')::boolean
      where id = (p_change->>'slot_id')::uuid and cycle_id = p_cycle;
  elsif t = 'slot_kind' then
    update time_slots set kind = (p_change->>'kind')::slot_kind
      where id = (p_change->>'slot_id')::uuid and cycle_id = p_cycle;
  elsif t not in ('manual','regenerate') then
    raise exception 'unknown change type %', t;
  end if;

  -- Mentors may only REMOVE their own assignments; they never overwrite anyone else's.
  if not admin and exists (
    select 1 from assignments where id = any(coalesce(p_remove, '{}')) and cycle_mentor_id <> cm) then
    raise exception 'forbidden: not your assignment';
  end if;

  delete from assignments where cycle_id = p_cycle and id = any(coalesce(p_remove, '{}'));
  if admin then
    insert into assignments(cycle_id, slot_id, cycle_mentor_id, cycle_team_id, locked)
    select p_cycle, (r->>'slot_id')::uuid, (r->>'cycle_mentor_id')::uuid, (r->>'cycle_team_id')::uuid,
           coalesce((r->>'locked')::boolean, false)
    from jsonb_array_elements(coalesce(p_add,'[]')) r
    on conflict (slot_id, cycle_mentor_id) do update
      set cycle_team_id = excluded.cycle_team_id, locked = excluded.locked;
  else
    -- rebalancing fill-ins only: never into a slot where that mentor is already booked
    insert into assignments(cycle_id, slot_id, cycle_mentor_id, cycle_team_id)
    select p_cycle, (r->>'slot_id')::uuid, (r->>'cycle_mentor_id')::uuid, (r->>'cycle_team_id')::uuid
    from jsonb_array_elements(coalesce(p_add,'[]')) r
    on conflict (slot_id, cycle_mentor_id) do nothing;
  end if;
  get diagnostics n = row_count;
  perform assert_no_overbooking(p_cycle);
  insert into audit_logs(actor, action, entity, entity_id, details)
  values (auth.uid(), 'commit_change:' || t, 'cycle', p_cycle::text,
          jsonb_build_object('change', p_change, 'removed', coalesce(cardinality(p_remove),0), 'added', n));
  return n;
end $$;
revoke all on function commit_change(uuid, jsonb, uuid[], jsonb) from public, anon;
grant execute on function commit_change(uuid, jsonb, uuid[], jsonb) to authenticated, service_role;

-- Free-tier usage report for admins (database size vs. the 500 MB free limit).
create or replace function usage_stats() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'rows', jsonb_build_object(
      'assignments', (select count(*) from assignments),
      'teams', (select count(*) from teams),
      'mentors', (select count(*) from mentors),
      'cycles', (select count(*) from cycles),
      'audit_logs', (select count(*) from audit_logs),
      'profiles', (select count(*) from profiles)));
end $$;
revoke all on function usage_stats() from public, anon;
grant execute on function usage_stats() to authenticated;

-- Retention helper: trims old audit logs so storage stays bounded on the free tier.
create or replace function prune_audit_logs(p_keep_days int default 180) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_super_admin() then raise exception 'forbidden'; end if;
  delete from audit_logs where created_at < now() - make_interval(days => p_keep_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function prune_audit_logs(int) from public, anon;
grant execute on function prune_audit_logs(int) to authenticated;

-- Live schedule updates: ONE table in the realtime publication (assignments), subscribed per open cycle.
do $$ begin
  alter publication supabase_realtime add table assignments;
exception when others then null; end $$;
