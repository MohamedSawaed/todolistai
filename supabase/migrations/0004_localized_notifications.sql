-- Notifications in the user's language: the database returns the facts, and the app
-- server writes the text with the same translations as the app.

drop function if exists public.claim_due_notifications(text);

create function public.claim_due_notifications(p_secret text)
returns table (
  endpoint text, p256dh text, auth text,
  kind text,            -- 'event' | 'task' | 'briefing' | 'review'
  item_title text,      -- event/task title, or the first event of the day (briefing)
  at_time timestamptz,  -- event start / task due / first event start
  minutes int,          -- reminder offset (events, tasks)
  location text,
  tz text, clock text, locale text,
  n_events int, n_tasks int, n_open int,  -- briefing counts
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

  -- 1. event reminders (each offset fires once; up to 15 minutes late if the timer was delayed)
  for r in
    select e.id, e.user_id, e.title, e.start_at, e.location, m.minutes,
           coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock, coalesce(p.locale, 'en') as locale
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
    return query select s.endpoint, s.p256dh, s.auth, 'event'::text, r.title::text, r.start_at, r.minutes, r.location::text,
      r.tz::text, r.clock::text, r.locale::text, null::int, null::int, null::int, '/'::text, ('event-' || r.id || '-' || r.minutes)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 2. task reminders (tasks with a due date + time + reminder)
  for r in
    select t.id, t.user_id, t.title, t.reminder_minutes,
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
    insert into public.reminder_deliveries (user_id, kind, ref_id, fire_key)
    values (r.user_id, 'task', r.id, r.due_at::text || ':' || r.reminder_minutes)
    on conflict do nothing;
    if not found then continue; end if;
    return query select s.endpoint, s.p256dh, s.auth, 'task'::text, r.title::text, r.due_at, r.reminder_minutes, null::text,
      r.tz::text, r.clock::text, r.locale::text, null::int, null::int, null::int, '/tasks'::text, ('task-' || r.id)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 3. morning briefing at the user's chosen time, including earlier unfinished items
  for r in
    select p.id as user_id, coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock, coalesce(p.locale, 'en') as locale,
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

    return query select s.endpoint, s.p256dh, s.auth, 'briefing'::text, v_first.title::text, v_first.start_at, null::int, null::text,
      r.tz::text, r.clock::text, r.locale::text, v_events, v_tasks, v_open, '/'::text, ('briefing-' || r.local_day)::text
      from public.push_subscriptions s where s.user_id = r.user_id;
  end loop;

  -- 4. evening review: ask (never assume) when today has ended items not marked done
  for r in
    select p.id as user_id, coalesce(p.timezone, 'UTC') as tz, coalesce(p.preferences ->> 'clock', '24h') as clock, coalesce(p.locale, 'en') as locale,
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
