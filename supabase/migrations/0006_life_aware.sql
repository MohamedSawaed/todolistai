-- Life-aware assistant:
--  * one-tap action details on events (phone number, link) + preparation links
--  * recorded activity time (separate from the scheduled time)
--  * notification rules: categories, quiet hours, frequency cap, deep links

-- ---------------------------------------------------------------- events
alter table public.calendar_events
  add column if not exists phone text check (phone is null or phone ~ '^\+?[0-9 ()./-]{3,30}$'),
  add column if not exists url text check (url is null or (url ~* '^https://' and char_length(url) <= 600)),
  add column if not exists prep_for uuid,
  add column if not exists prep_dismissed_at timestamptz;

do $$ begin
  alter table public.calendar_events
    add constraint calendar_events_prep_for_fkey foreign key (prep_for, user_id)
    references public.calendar_events (id, user_id) on delete set null (prep_for);
exception when duplicate_object then null;
end $$;

create or replace function public.create_event_checked(p_event jsonb, p_allow_overlap boolean, p_buffer int)
returns jsonb language plpgsql security invoker as $$
declare
  v_conflicts jsonb;
  v_row public.calendar_events;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform public._lock_user_schedule();
  if not p_allow_overlap then
    v_conflicts := public._conflicts((p_event ->> 'startAt')::timestamptz, (p_event ->> 'endAt')::timestamptz, p_buffer, null);
    if jsonb_array_length(v_conflicts) > 0 then
      return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
    end if;
  end if;
  insert into public.calendar_events (user_id, title, description, start_at, end_at, timezone, category, flexibility, location, reminders, task_id, source, phone, url, prep_for)
  values (auth.uid(), p_event ->> 'title', p_event ->> 'description', (p_event ->> 'startAt')::timestamptz, (p_event ->> 'endAt')::timestamptz,
          p_event ->> 'timezone', p_event ->> 'category', p_event ->> 'flexibility', p_event ->> 'location',
          public._int_array(coalesce(p_event -> 'reminders', '[]'::jsonb)), (p_event ->> 'taskId')::uuid,
          case when jsonb_typeof(p_event -> 'source') = 'object' then p_event -> 'source' else null end,
          p_event ->> 'phone', p_event ->> 'url', (p_event ->> 'prepFor')::uuid)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'event', to_jsonb(v_row));
end $$;

create or replace function public.update_event_checked(p_id uuid, p_patch jsonb, p_expected_version int, p_allow_overlap boolean, p_buffer int)
returns jsonb language plpgsql security invoker as $$
declare
  v_cur public.calendar_events;
  v_start timestamptz;
  v_end timestamptz;
  v_conflicts jsonb;
  v_row public.calendar_events;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform public._lock_user_schedule();
  select * into v_cur from public.calendar_events where id = p_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'notFound', true); end if;
  if p_expected_version is not null and v_cur.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'versionConflict', true, 'current', to_jsonb(v_cur));
  end if;
  v_start := coalesce((p_patch ->> 'startAt')::timestamptz, v_cur.start_at);
  v_end := coalesce((p_patch ->> 'endAt')::timestamptz, v_cur.end_at);
  if (v_start <> v_cur.start_at or v_end <> v_cur.end_at) and not p_allow_overlap then
    v_conflicts := public._conflicts(v_start, v_end, p_buffer, array[p_id]);
    if jsonb_array_length(v_conflicts) > 0 then
      return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
    end if;
  end if;
  update public.calendar_events set
    title = case when p_patch ? 'title' then p_patch ->> 'title' else title end,
    description = case when p_patch ? 'description' then p_patch ->> 'description' else description end,
    start_at = v_start,
    end_at = v_end,
    timezone = case when p_patch ? 'timezone' then p_patch ->> 'timezone' else timezone end,
    category = case when p_patch ? 'category' then p_patch ->> 'category' else category end,
    flexibility = case when p_patch ? 'flexibility' then p_patch ->> 'flexibility' else flexibility end,
    location = case when p_patch ? 'location' then p_patch ->> 'location' else location end,
    reminders = case when p_patch ? 'reminders' then public._int_array(p_patch -> 'reminders') else reminders end,
    completed_at = case when p_patch ? 'completedAt' then (p_patch ->> 'completedAt')::timestamptz else completed_at end,
    followup_dismissed_at = case when p_patch ? 'followUpDismissedAt' then (p_patch ->> 'followUpDismissedAt')::timestamptz else followup_dismissed_at end,
    source = case when p_patch ? 'source' then (case when jsonb_typeof(p_patch -> 'source') = 'object' then p_patch -> 'source' else null end) else source end,
    phone = case when p_patch ? 'phone' then p_patch ->> 'phone' else phone end,
    url = case when p_patch ? 'url' then p_patch ->> 'url' else url end,
    prep_dismissed_at = case when p_patch ? 'prepDismissedAt' then (p_patch ->> 'prepDismissedAt')::timestamptz else prep_dismissed_at end,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'event', to_jsonb(v_row));
end $$;

-- ---------------------------------------------------------------- recorded activity time
-- What actually happened, kept apart from what was scheduled. A timer session runs from
-- "Start" to "Finish" (pauses excluded); the user confirms or corrects the result.
create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid,
  activity_key text not null check (char_length(activity_key) between 1 and 120),
  title text not null check (char_length(title) between 1 and 200),
  category text not null default 'personal' check (category in ('work', 'personal', 'learning', 'health', 'important')),
  scheduled_minutes int check (scheduled_minutes between 1 and 10080),
  started_at timestamptz,
  paused_at timestamptz,
  paused_seconds int not null default 0 check (paused_seconds >= 0),
  ended_at timestamptz,
  actual_minutes int check (actual_minutes between 1 and 1440),
  source text not null check (source in ('timer', 'manual')),
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (event_id, user_id) references public.calendar_events (id, user_id) on delete set null (event_id)
);
create index if not exists activity_sessions_user_key_idx on public.activity_sessions (user_id, activity_key, created_at desc);
create unique index if not exists activity_sessions_one_running on public.activity_sessions (user_id) where ended_at is null and source = 'timer';
alter table public.activity_sessions enable row level security;
drop policy if exists "own sessions" on public.activity_sessions;
create policy "own sessions" on public.activity_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- notification rules
-- Category switches, quiet hours, Busy Workweek mode, and a cap of 6 notifications per 15 minutes.
create or replace function private._notify_ok(p_user uuid, p_prefs jsonb, p_tz text, p_kind text)
returns boolean language plpgsql stable security definer set search_path = public, private as $$
declare
  n jsonb := coalesce(p_prefs -> 'notifications', '{}'::jsonb);
  q jsonb := coalesce(n -> 'quietHours', '{}'::jsonb);
  t time := (now() at time zone p_tz)::time;
  qs time;
  qe time;
  mode jsonb := p_prefs -> 'lifeMode';
begin
  if p_kind = 'event' and not coalesce((n ->> 'upcoming')::boolean, true) then return false; end if;
  if p_kind = 'task' and not coalesce((n ->> 'deadlines')::boolean, true) then return false; end if;
  if coalesce((q ->> 'enabled')::boolean, false) then
    qs := coalesce(q ->> 'start', '22:00')::time;
    qe := coalesce(q ->> 'end', '07:00')::time;
    if (qs <= qe and t >= qs and t < qe) or (qs > qe and (t >= qs or t < qe)) then return false; end if;
  end if;
  -- Busy Workweek keeps notifications to what's essential
  if p_kind = 'review' and mode ->> 'type' = 'busy'
     and (mode ->> 'until' is null or (mode ->> 'until')::date >= (now() at time zone p_tz)::date) then
    return false;
  end if;
  if (select count(*) from public.reminder_deliveries d where d.user_id = p_user and d.sent_at > now() - interval '15 minutes') >= 6 then
    return false;
  end if;
  return true;
end $$;

drop function if exists public.claim_due_notifications(text);

create function public.claim_due_notifications(p_secret text)
returns table (
  endpoint text, p256dh text, auth text,
  kind text,            -- 'event' | 'task' | 'briefing' | 'review'
  item_title text,
  at_time timestamptz,
  minutes int,
  location text,
  tz text, clock text, locale text,
  n_events int, n_tasks int, n_open int,
  url text, tag text
)
language plpgsql security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  r record;
  v_events int;
  v_tasks int;
  v_open int;
  v_first record;
begin
  perform private._check_dispatch_secret(p_secret);

  -- 1. event reminders → open the event
  for r in
    select e.id, e.user_id, e.title, e.start_at, e.location, m.minutes, p.preferences,
           coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock, coalesce(p.locale, 'en') as locale
    from public.calendar_events e
    cross join lateral unnest(e.reminders) as m(minutes)
    join public.profiles p on p.id = e.user_id
    where e.completed_at is null
      and coalesce((p.preferences -> 'notifications' ->> 'browser')::boolean, false)
      and e.start_at - make_interval(mins => m.minutes) <= now()
      and e.start_at - make_interval(mins => m.minutes) > now() - interval '15 minutes'
  loop
    if not private._notify_ok(r.user_id, r.preferences, r.tz, 'event') then continue; end if;
    insert into public.reminder_deliveries (user_id, kind, ref_id, fire_key)
    values (r.user_id, 'event', r.id, r.start_at::text || ':' || r.minutes)
    on conflict do nothing;
    if not found then continue; end if;
    return query select s.endpoint, s.p256dh, s.auth, 'event'::text, r.title::text, r.start_at, r.minutes, r.location::text,
      r.tz::text, r.clock::text, r.locale::text, null::int, null::int, null::int, ('/?event=' || r.id)::text, ('event-' || r.id || '-' || r.minutes)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 2. task deadlines → open tasks
  for r in
    select t.id, t.user_id, t.title, t.reminder_minutes, p.preferences,
           ((t.due_date + t.due_time) at time zone coalesce(p.timezone, 'UTC')) as due_at,
           coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock, coalesce(p.locale, 'en') as locale
    from public.tasks t
    join public.profiles p on p.id = t.user_id
    where t.status = 'open' and t.due_date is not null and t.due_time is not null and t.reminder_minutes is not null
      and coalesce((p.preferences -> 'notifications' ->> 'browser')::boolean, false)
  loop
    if r.due_at - make_interval(mins => r.reminder_minutes) > now()
       or r.due_at - make_interval(mins => r.reminder_minutes) <= now() - interval '15 minutes' then
      continue;
    end if;
    if not private._notify_ok(r.user_id, r.preferences, r.tz, 'task') then continue; end if;
    insert into public.reminder_deliveries (user_id, kind, ref_id, fire_key)
    values (r.user_id, 'task', r.id, r.due_at::text || ':' || r.reminder_minutes)
    on conflict do nothing;
    if not found then continue; end if;
    return query select s.endpoint, s.p256dh, s.auth, 'task'::text, r.title::text, r.due_at, r.reminder_minutes, null::text,
      r.tz::text, r.clock::text, r.locale::text, null::int, null::int, null::int, '/tasks'::text, ('task-' || r.id)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 3. morning briefing
  for r in
    select p.id as user_id, p.preferences, coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock, coalesce(p.locale, 'en') as locale,
           coalesce(p.preferences -> 'notifications' ->> 'briefingTime', '08:00') as at_time,
           (now() at time zone coalesce(p.timezone, 'UTC'))::date as local_day
    from public.profiles p
    where coalesce((p.preferences -> 'notifications' ->> 'browser')::boolean, false)
      and coalesce((p.preferences -> 'notifications' ->> 'morningBriefing')::boolean, true)
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  loop
    if (now() at time zone r.tz)::time < r.at_time::time
       or (now() at time zone r.tz)::time >= r.at_time::time + interval '30 minutes' then
      continue;
    end if;
    if not private._notify_ok(r.user_id, r.preferences, r.tz, 'briefing') then continue; end if;
    insert into public.reminder_deliveries (user_id, kind, fire_key) values (r.user_id, 'briefing', r.local_day::text)
    on conflict do nothing;
    if not found then continue; end if;

    select count(*) into v_events from public.calendar_events e
      where e.user_id = r.user_id and (e.start_at at time zone r.tz)::date = r.local_day;
    select count(*) into v_tasks from public.tasks t
      where t.user_id = r.user_id and t.status = 'open' and t.due_date <= r.local_day;
    select count(*) into v_open from public.calendar_events e
      where e.user_id = r.user_id and e.completed_at is null and e.followup_dismissed_at is null
        and e.end_at < (r.local_day::timestamp at time zone r.tz)
        and e.end_at > (r.local_day::timestamp at time zone r.tz) - interval '14 days';
    select e.title, e.start_at into v_first from public.calendar_events e
      where e.user_id = r.user_id and (e.start_at at time zone r.tz)::date = r.local_day and e.start_at > now()
      order by e.start_at limit 1;

    return query select s.endpoint, s.p256dh, s.auth, 'briefing'::text, v_first.title::text, v_first.start_at, null::int, null::text,
      r.tz::text, r.clock::text, r.locale::text, v_events, v_tasks, v_open, '/'::text, ('briefing-' || r.local_day)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 4. evening review (asks; never assumes)
  for r in
    select p.id as user_id, p.preferences, coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock, coalesce(p.locale, 'en') as locale,
           coalesce(p.preferences -> 'notifications' ->> 'reviewTime', '20:00') as at_time,
           (now() at time zone coalesce(p.timezone, 'UTC'))::date as local_day
    from public.profiles p
    where coalesce((p.preferences -> 'notifications' ->> 'browser')::boolean, false)
      and coalesce((p.preferences -> 'notifications' ->> 'eveningReview')::boolean, true)
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  loop
    if (now() at time zone r.tz)::time < r.at_time::time
       or (now() at time zone r.tz)::time >= r.at_time::time + interval '30 minutes' then
      continue;
    end if;
    if not private._notify_ok(r.user_id, r.preferences, r.tz, 'review') then continue; end if;
    select count(*) into v_open from public.calendar_events e
      where e.user_id = r.user_id and e.completed_at is null and e.followup_dismissed_at is null
        and (e.start_at at time zone r.tz)::date = r.local_day and e.end_at <= now();
    if v_open = 0 then continue; end if;
    insert into public.reminder_deliveries (user_id, kind, fire_key) values (r.user_id, 'review', r.local_day::text)
    on conflict do nothing;
    if not found then continue; end if;
    return query select s.endpoint, s.p256dh, s.auth, 'review'::text, null::text, null::timestamptz, null::int, null::text,
      r.tz::text, r.clock::text, r.locale::text, null::int, null::int, v_open, '/?review=1'::text, ('review-' || r.local_day)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  delete from public.reminder_deliveries where sent_at < now() - interval '60 days';
end $$;

revoke all on function public.claim_due_notifications(text) from public;
grant execute on function public.claim_due_notifications(text) to anon, authenticated;
