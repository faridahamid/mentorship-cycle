-- 0003: Enable multiple teams per mentor in each rotation slot.
-- A mentor visits multiple teams (quota) per rotation session.
-- Teams are clustered by category and physical proximity.

-- 1. Drop old single-team-per-mentor unique constraint
alter table assignments drop constraint if exists assignments_slot_id_cycle_mentor_id_key;

-- 2. Add composite unique constraint allowing multiple teams per mentor, but preventing duplicate same-team assignment in the same slot
alter table assignments drop constraint if exists assignments_slot_mentor_team_uq;
alter table assignments add constraint assignments_slot_mentor_team_uq unique (slot_id, cycle_mentor_id, cycle_team_id);

-- 3. Update commit_change function to conflict on (slot_id, cycle_mentor_id, cycle_team_id)
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
    on conflict (slot_id, cycle_mentor_id, cycle_team_id) do update
      set locked = excluded.locked;
  else
    insert into assignments(cycle_id, slot_id, cycle_mentor_id, cycle_team_id)
    select p_cycle, (r->>'slot_id')::uuid, (r->>'cycle_mentor_id')::uuid, (r->>'cycle_team_id')::uuid
    from jsonb_array_elements(coalesce(p_add,'[]')) r
    on conflict (slot_id, cycle_mentor_id, cycle_team_id) do nothing;
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

