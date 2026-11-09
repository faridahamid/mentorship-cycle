-- Mentor Cycle Management Platform: core schema (Supabase PostgreSQL)
-- Roles: super_admin > admin > mentor. Authorization enforced by RLS.

create extension if not exists pgcrypto;

-- ───────── Enums ─────────
create type app_role as enum ('super_admin', 'admin', 'mentor');
create type schedule_mode as enum ('sequential', 'simultaneous');
create type cycle_status as enum ('draft', 'active', 'archived');
create type slot_kind as enum ('session', 'break');
create type member_status as enum ('active', 'absent', 'removed');

-- ───────── Profiles & roles ─────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null,
  role app_role not null default 'mentor',
  created_at timestamptz not null default now()
);
create index profiles_role_idx on profiles(role);

-- ───────── Locations (building > floor > section) ─────────
create table locations (
  id uuid primary key default gen_random_uuid(),
  building text not null,
  floor int not null default 0,
  section text not null default '',
  unique (building, floor, section)
);

-- ───────── Categories ─────────
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#6366f1',
  created_at timestamptz not null default now()
);

-- ───────── Mentors (persistent, reusable across cycles) ─────────
create table mentors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references profiles(id) on delete set null,
  full_name text not null,
  gender text,
  location_id uuid references locations(id) on delete set null,
  created_at timestamptz not null default now()
);
create table mentor_categories (
  mentor_id uuid references mentors(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  primary key (mentor_id, category_id)
);
create index mentor_categories_cat_idx on mentor_categories(category_id);

-- ───────── Teams ─────────
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location_id uuid references locations(id) on delete set null,
  info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index teams_name_uq on teams (lower(trim(name)));
create table team_categories (
  team_id uuid references teams(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  primary key (team_id, category_id)
);
create index team_categories_cat_idx on team_categories(category_id);

-- ───────── Cycles ─────────
create table cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  daily_start time not null,
  daily_end time not null,
  session_minutes int not null check (session_minutes > 0),
  break_count int not null default 0 check (break_count >= 0),
  break_minutes int not null default 0 check (break_minutes >= 0),
  mode schedule_mode not null default 'sequential',
  max_simultaneous int not null default 2 check (max_simultaneous >= 1),
  status cycle_status not null default 'draft',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (daily_end > daily_start)
);
create index cycles_status_idx on cycles(status);

create table cycle_categories (
  cycle_id uuid references cycles(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  primary key (cycle_id, category_id)
);

-- Cycle membership holds a snapshot of names so history survives profile edits.
create table cycle_mentors (
  cycle_id uuid references cycles(id) on delete cascade,
  mentor_id uuid references mentors(id) on delete set null,
  id uuid primary key default gen_random_uuid(),
  mentor_name text not null,
  categories uuid[] not null default '{}',
  location_id uuid references locations(id) on delete set null,
  status member_status not null default 'active',
  unique (cycle_id, mentor_id)
);
create index cycle_mentors_cycle_idx on cycle_mentors(cycle_id);

create table cycle_teams (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references cycles(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  team_name text not null,
  categories uuid[] not null default '{}',
  location_id uuid references locations(id) on delete set null,
  status member_status not null default 'active',
  unique (cycle_id, team_id)
);
create index cycle_teams_cycle_idx on cycle_teams(cycle_id);

create table time_slots (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references cycles(id) on delete cascade,
  idx int not null,
  day date not null,
  starts_at time not null,
  ends_at time not null,
  kind slot_kind not null default 'session',
  enabled boolean not null default true,
  unique (cycle_id, idx),
  check (ends_at > starts_at)
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references cycles(id) on delete cascade,
  slot_id uuid not null references time_slots(id) on delete cascade,
  cycle_mentor_id uuid not null references cycle_mentors(id) on delete cascade,
  cycle_team_id uuid not null references cycle_teams(id) on delete cascade,
  locked boolean not null default false,   -- manual edits are preserved on regeneration
  created_at timestamptz not null default now(),
  -- Mentors can hold multiple teams per rotation slot. Unique per mentor + team per slot.
  unique (slot_id, cycle_mentor_id, cycle_team_id)
);
create index assignments_cycle_idx on assignments(cycle_id);
create index assignments_mentor_idx on assignments(cycle_mentor_id, slot_id);
create index assignments_team_idx on assignments(cycle_team_id);
-- Mentor overbooking is prevented by trigger-free function check in apply_schedule();
-- simultaneous mode allows several mentors per team, and several teams per mentor
-- only up to cycles.max_simultaneous (validated in the RPC).

create table mentor_availability (
  id uuid primary key default gen_random_uuid(),
  cycle_mentor_id uuid not null references cycle_mentors(id) on delete cascade,
  slot_id uuid not null references time_slots(id) on delete cascade,
  reason text not null check (reason in ('absent', 'break')),
  requested_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (cycle_mentor_id, slot_id)
);
create table team_availability (
  id uuid primary key default gen_random_uuid(),
  cycle_team_id uuid not null references cycle_teams(id) on delete cascade,
  slot_id uuid not null references time_slots(id) on delete cascade,
  reason text not null default 'absent',
  created_at timestamptz not null default now(),
  unique (cycle_team_id, slot_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_profile_idx on notifications(profile_id, read);

create table audit_logs (
  id bigint generated always as identity primary key,
  actor uuid references profiles(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs(created_at desc);

-- ───────── Auth helpers ─────────
create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(current_role_name() in ('admin','super_admin'), false) $$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(current_role_name() = 'super_admin', false) $$;

create or replace function my_cycle_mentor_ids() returns setof uuid
language sql stable security definer set search_path = public as
$$ select cm.id from cycle_mentors cm join mentors m on m.id = cm.mentor_id
   where m.profile_id = auth.uid() $$;

-- Profile creation on signup. Role is ALWAYS 'mentor' here; privilege escalation
-- is impossible from client metadata. Admins are promoted by super admin only.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m_id uuid; cat uuid;
begin
  insert into profiles(id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email, 'mentor');
  if coalesce(new.raw_user_meta_data->>'signup_kind','') = 'mentor' then
    insert into mentors(profile_id, full_name, location_id)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email),
            nullif(new.raw_user_meta_data->>'location_id','')::uuid) returning id into m_id;
    for cat in select (jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'categories','[]'::jsonb)))::uuid loop
      insert into mentor_categories values (m_id, cat) on conflict do nothing;
    end loop;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

-- Backfill any existing auth users into profiles
insert into profiles (id, full_name, email, role)
select 
  id, 
  coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)), 
  coalesce(email, ''), 
  'mentor'
from auth.users
on conflict (id) do nothing;

-- ───────── Row Level Security ─────────
alter table profiles enable row level security;
alter table locations enable row level security;
alter table categories enable row level security;
alter table mentors enable row level security;
alter table mentor_categories enable row level security;
alter table teams enable row level security;
alter table team_categories enable row level security;
alter table cycles enable row level security;
alter table cycle_categories enable row level security;
alter table cycle_mentors enable row level security;
alter table cycle_teams enable row level security;
alter table time_slots enable row level security;
alter table assignments enable row level security;
alter table mentor_availability enable row level security;
alter table team_availability enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;

-- profiles: self read; admins read all; only super admin changes roles.
create policy profiles_read on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update_self on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy profiles_super on profiles for all using (is_super_admin()) with check (is_super_admin());

-- Reference data: any authenticated user reads; admins write (categories: super admin).
create policy loc_read on locations for select using (true);  -- needed on public mentor signup page
create policy loc_write on locations for all using (is_admin()) with check (is_admin());
create policy cat_read on categories for select using (true);  -- needed on public mentor signup page
create policy cat_write on categories for all using (is_super_admin()) with check (is_super_admin());

create policy mentors_read on mentors for select to authenticated using (is_admin() or profile_id = auth.uid());
create policy mentors_write on mentors for all using (is_admin()) with check (is_admin());
create policy mentors_self_update on mentors for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy mc_read on mentor_categories for select to authenticated using (true);
create policy mc_write on mentor_categories for all using (is_admin()) with check (is_admin());
create policy mc_self on mentor_categories for all
  using (mentor_id in (select id from mentors where profile_id = auth.uid()))
  with check (mentor_id in (select id from mentors where profile_id = auth.uid()));

create policy teams_admin on teams for all using (is_admin()) with check (is_admin());
create policy tc_admin on team_categories for all using (is_admin()) with check (is_admin());

create policy cycles_read on cycles for select to authenticated using (true);
create policy cycles_write on cycles for all using (is_admin()) with check (is_admin());
create policy cyc_cat_read on cycle_categories for select to authenticated using (true);
create policy cyc_cat_write on cycle_categories for all using (is_admin()) with check (is_admin());
create policy slots_read on time_slots for select to authenticated using (true);
create policy slots_write on time_slots for all using (is_admin()) with check (is_admin());

create policy cm_read on cycle_mentors for select to authenticated using (true);
create policy cm_write on cycle_mentors for all using (is_admin()) with check (is_admin());
create policy ct_admin on cycle_teams for all using (is_admin()) with check (is_admin());
-- mentors see only teams they are assigned to
create policy ct_mentor_read on cycle_teams for select to authenticated using (
  id in (select cycle_team_id from assignments where cycle_mentor_id in (select my_cycle_mentor_ids())));

create policy asg_admin on assignments for all using (is_admin()) with check (is_admin());
create policy asg_mentor_read on assignments for select to authenticated
  using (cycle_mentor_id in (select my_cycle_mentor_ids()));

create policy ma_admin on mentor_availability for all using (is_admin()) with check (is_admin());
create policy ma_self_read on mentor_availability for select to authenticated
  using (cycle_mentor_id in (select my_cycle_mentor_ids()));
create policy ma_self_insert on mentor_availability for insert to authenticated
  with check (cycle_mentor_id in (select my_cycle_mentor_ids()) and requested_by = auth.uid());
create policy ma_self_delete on mentor_availability for delete to authenticated
  using (cycle_mentor_id in (select my_cycle_mentor_ids()));
create policy ta_admin on team_availability for all using (is_admin()) with check (is_admin());

create policy notif_self on notifications for select using (profile_id = auth.uid());
create policy notif_self_update on notifications for update using (profile_id = auth.uid());
create policy notif_admin_insert on notifications for insert with check (is_admin());

create policy audit_super_read on audit_logs for select using (is_super_admin());
create policy audit_insert on audit_logs for insert to authenticated with check (actor = auth.uid());

-- ───────── Transaction-safe schedule application ─────────
-- Replaces unlocked assignments of a cycle atomically with a computed set.
-- p_rows: [{slot_id, cycle_mentor_id, cycle_team_id}]
create or replace function apply_schedule(p_cycle uuid, p_rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  delete from assignments where cycle_id = p_cycle and not locked;
  insert into assignments(cycle_id, slot_id, cycle_mentor_id, cycle_team_id)
  select p_cycle, (r->>'slot_id')::uuid, (r->>'cycle_mentor_id')::uuid, (r->>'cycle_team_id')::uuid
  from jsonb_array_elements(p_rows) r
  on conflict (slot_id, cycle_mentor_id) do nothing;
  get diagnostics n = row_count;
  perform assert_no_overbooking(p_cycle);
  insert into audit_logs(actor, action, entity, entity_id, details)
  values (auth.uid(), 'apply_schedule', 'cycle', p_cycle::text, jsonb_build_object('inserted', n));
  return n;
end $$;


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

-- Promote initial super_admin if the account was already provisioned
update public.profiles
set role = 'super_admin'
where email = 'nasa-superadmin@nasa.com';
