-- 0006: Allow simultaneous mentors per team based on team categories count
create or replace function assert_no_overbooking(p_cycle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare lim int;
begin
  select case when mode = 'simultaneous' then greatest(1, coalesce(max_simultaneous, 2)) else 1 end into lim from cycles where id = p_cycle;
  if exists (
    select 1 
    from assignments a
    join cycle_teams ct on ct.id = a.cycle_team_id
    where a.cycle_id = p_cycle 
    group by a.slot_id, a.cycle_team_id, ct.categories
    having count(*) > case 
      when (select mode from cycles where id = p_cycle) = 'simultaneous' 
      then greatest(lim, coalesce(cardinality(ct.categories), 1))
      else 1 
    end
  ) then
    raise exception 'team overbooked: more than allowed mentors in a slot';
  end if;
end $$;

