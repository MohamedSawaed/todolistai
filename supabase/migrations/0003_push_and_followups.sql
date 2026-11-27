-- Push notifications (delivered even when the app is closed) and next-day follow-ups.
--
-- Flow: pg_cron calls the app's /api/push/dispatch endpoint every minute (see
-- supabase/setup-cron.example.sql). The endpoint calls claim_due_notifications(),
-- which returns each due notification once and records it in reminder_deliveries.

-- ---------------------------------------------------------------- follow-ups
alter table public.calendar_events add column if not exists followup_dismissed_at timestamptz;

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
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'event', to_jsonb(v_row));
end $$;

-- ---------------------------------------------------------------- push subscriptions
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A device may have belonged to another signed-in user before; take it over safely.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- delivery log + secret
create table if not exists public.reminder_deliveries (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,          -- 'event' | 'task' | 'briefing'
  ref_id uuid not null default '00000000-0000-0000-0000-000000000000', -- event / task id (zero for briefings)
  fire_key text not null,      -- what exactly fired, e.g. '<start>:<minutes>' or a local date
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, fire_key, ref_id)
);
alter table public.reminder_deliveries enable row level security; -- no policies: only the functions below touch it

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.app_config (key text primary key, value text not null);

create or replace function private._check_dispatch_secret(p_secret text) returns void
language plpgsql security definer set search_path = private as $$
begin
  if p_secret is null or p_secret = '' or not exists (select 1 from private.app_config where key = 'dispatch_secret' and value = p_secret) then
    raise exception 'invalid dispatch secret' using errcode = '28000';
  end if;
end $$;

-- local "today" / "tomorrow" / weekday + time, in the user's timezone and clock format
create or replace function private._when(p_at timestamptz, p_tz text, p_clock text) returns text
language sql stable as $$
  select case
           when (p_at at time zone p_tz)::date = (now() at time zone p_tz)::date then 'today'
           when (p_at at time zone p_tz)::date = (now() at time zone p_tz)::date + 1 then 'tomorrow'
           else trim(to_char(p_at at time zone p_tz, 'FMDay'))
         end
         || ' at '
         || case when p_clock = '12h' then trim(to_char(p_at at time zone p_tz, 'FMHH12:MI AM')) else to_char(p_at at time zone p_tz, 'HH24:MI') end;
$$;

-- ---------------------------------------------------------------- what to send now
create or replace function public.claim_due_notifications(p_secret text)
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = public, private as $$
#variable_conflict use_column
declare
  r record;
  v_body text;
  v_events int;
  v_tasks int;
  v_open int;
  v_first record;
begin
  perform private._check_dispatch_secret(p_secret);

  -- 1. event reminders (each offset fires once; up to 15 minutes late if the timer was delayed)
  for r in
    select e.id, e.user_id, e.title, e.start_at, e.location, m.minutes,
           coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock
    from public.calendar_events e
    cross join lateral unnest(e.reminders) as m(minutes)
    join public.profiles p on p.id = e.user_id
    where e.completed_at is null
      and coalesce((p.preferences -> 'notifications' ->> 'browser')::boolean, false)
      and e.start_at - make_interval(mins => m.minutes) <= now()
      and e.start_at - make_interval(mins => m.minutes) > now() - interval '15 minutes'
  loop
    insert into public.reminder_deliveries (user_id, kind, ref_id, fire_key)
    values (r.user_id, 'event', r.id, r.start_at::text || ':' || r.minutes)
    on conflict do nothing;
    if not found then continue; end if;
    v_body := case when r.minutes = 0 then 'Starting now' else 'Starts ' || private._when(r.start_at, r.tz, r.clock) end
              || coalesce(' · ' || r.location, '');
    return query select s.endpoint, s.p256dh, s.auth, r.title::text, v_body, '/'::text, ('event-' || r.id || '-' || r.minutes)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 2. task reminders (tasks with a due date + time + reminder)
  for r in
    select t.id, t.user_id, t.title, t.reminder_minutes,
           ((t.due_date + t.due_time) at time zone coalesce(p.timezone, 'UTC')) as due_at,
           coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock
    from public.tasks t
    join public.profiles p on p.id = t.user_id
    where t.status = 'open' and t.due_date is not null and t.due_time is not null and t.reminder_minutes is not null
      and coalesce((p.preferences -> 'notifications' ->> 'browser')::boolean, false)
  loop
    if r.due_at - make_interval(mins => r.reminder_minutes) > now()
       or r.due_at - make_interval(mins => r.reminder_minutes) <= now() - interval '15 minutes' then
      continue;
    end if;
    insert into public.reminder_deliveries (user_id, kind, ref_id, fire_key)
    values (r.user_id, 'task', r.id, r.due_at::text || ':' || r.reminder_minutes)
    on conflict do nothing;
    if not found then continue; end if;
    return query select s.endpoint, s.p256dh, s.auth, r.title::text, ('Task due ' || private._when(r.due_at, r.tz, r.clock))::text, '/tasks'::text, ('task-' || r.id)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 3. morning briefing at the user's chosen time, including yesterday's unfinished items
  for r in
    select p.id as user_id, coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock,
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

    v_body := case when v_events = 0 then 'Nothing scheduled today.'
                   else v_events || case when v_events = 1 then ' thing' else ' things' end || ' on your calendar' end
              || case when v_first.title is not null then ' — first: ' || v_first.title || ' ' || private._when(v_first.start_at, r.tz, r.clock) || '.' else '.' end
              || case when v_tasks > 0 then ' ' || v_tasks || case when v_tasks = 1 then ' task' else ' tasks' end || ' due.' else '' end
              || case when v_open > 0 then ' ' || v_open || ' unfinished from before — tap to review.' else '' end;
    return query select s.endpoint, s.p256dh, s.auth, 'Good morning — your day'::text, v_body, '/'::text, ('briefing-' || r.local_day)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- keep the log small
  delete from public.reminder_deliveries where sent_at < now() - interval '60 days';
end $$;

create or replace function public.remove_push_subscription(p_secret text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  perform private._check_dispatch_secret(p_secret);
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;

revoke all on function public.claim_due_notifications(text) from public;
revoke all on function public.remove_push_subscription(text, text) from public;
grant execute on function public.claim_due_notifications(text) to anon, authenticated;
grant execute on function public.remove_push_subscription(text, text) to anon, authenticated;
