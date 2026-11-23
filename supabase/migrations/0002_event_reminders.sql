-- Multiple reminders per event (e.g. a day before and 2 hours before).

alter table public.calendar_events
  add column reminders int[] not null default '{}'
  check (cardinality(reminders) <= 5 and 0 <= all (reminders));

update public.calendar_events
  set reminders = array[reminder_minutes]
  where reminder_minutes is not null;

alter table public.calendar_events drop column reminder_minutes;

create or replace function public._int_array(p jsonb) returns int[] language sql immutable as $$
  select coalesce(array(select (x)::int from jsonb_array_elements_text(p) as x), '{}'::int[]);
$$;

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
  insert into public.calendar_events (user_id, title, description, start_at, end_at, timezone, category, flexibility, location, reminders, task_id)
  values (auth.uid(), p_event ->> 'title', p_event ->> 'description', (p_event ->> 'startAt')::timestamptz, (p_event ->> 'endAt')::timestamptz,
          p_event ->> 'timezone', p_event ->> 'category', p_event ->> 'flexibility', p_event ->> 'location',
          public._int_array(coalesce(p_event -> 'reminders', '[]'::jsonb)), (p_event ->> 'taskId')::uuid)
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
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'event', to_jsonb(v_row));
end $$;
