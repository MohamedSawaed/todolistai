-- Tempo — initial schema
-- Every user-owned table carries user_id and is protected by Row Level Security.
-- Scheduling writes go through SECURITY INVOKER functions that take a per-user
-- advisory lock, re-check conflicts and versions, then write — atomically.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  timezone text not null default 'UTC',
  locale text not null default 'en' check (locale in ('en', 'ar', 'he')),
  -- working hours, study/sleep hours, default durations, buffers, notification
  -- and AI preferences (validated server-side with Zod)
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- tasks
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  due_date date,
  due_time time,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'completed')),
  category text not null default 'personal' check (category in ('work', 'personal', 'learning', 'health', 'important')),
  reminder_minutes int check (reminder_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id)
);
create index tasks_user_due_idx on public.tasks (user_id, status, due_date);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  user_id uuid not null default auth.uid(),
  title text not null check (char_length(title) between 1 and 200),
  completed boolean not null default false,
  position int not null default 0,
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);
create index subtasks_task_idx on public.subtasks (task_id, position);

-- ---------------------------------------------------------------- calendar events
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  category text not null default 'personal' check (category in ('work', 'personal', 'learning', 'health', 'important')),
  flexibility text not null default 'fixed' check (flexibility in ('fixed', 'flexible')),
  location text check (char_length(location) <= 300),
  reminder_minutes int check (reminder_minutes >= 0),
  -- scheduled work session for a task (task may have many sessions)
  task_id uuid,
  completed_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (end_at - start_at <= interval '7 days'),
  unique (id, user_id),
  -- composite FK: a session can only point at a task owned by the same user
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete set null (task_id)
);
create index calendar_events_user_range_idx on public.calendar_events (user_id, start_at, end_at);
create index calendar_events_task_idx on public.calendar_events (task_id) where task_id is not null;

-- ---------------------------------------------------------------- notes
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  content text not null default '' check (char_length(content) <= 20000),
  note_date date,
  event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, user_id) references public.calendar_events (id, user_id) on delete set null (event_id)
);
create index notes_user_date_idx on public.notes (user_id, note_date);

-- ---------------------------------------------------------------- AI
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, created_at desc);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null default auth.uid(),
  -- exact Claude API message, replayed unchanged on later turns
  api_role text not null check (api_role in ('user', 'assistant')),
  api_content jsonb not null,
  display_role text check (display_role in ('user', 'assistant')),
  display_text text,
  proposal_ids uuid[] not null default '{}',
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.ai_conversations (id, user_id) on delete cascade
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, seq);

create table public.ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid references public.ai_conversations (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'applying', 'applied', 'cancelled', 'expired', 'undone')),
  payload jsonb not null,
  result jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index ai_action_proposals_user_idx on public.ai_action_proposals (user_id, status);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.subtasks enable row level security;
alter table public.calendar_events enable row level security;
alter table public.notes enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_action_proposals enable row level security;

create policy "own profile" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());
create policy "own tasks" on public.tasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own subtasks" on public.subtasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own events" on public.calendar_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notes" on public.notes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own conversations" on public.ai_conversations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own messages" on public.ai_messages for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own proposals" on public.ai_action_proposals for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- scheduling functions
-- All run as SECURITY INVOKER: RLS still applies, auth.uid() is the caller.

create function public._lock_user_schedule() returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended('schedule:' || auth.uid()::text, 0));
$$;

create function public._conflicts(p_start timestamptz, p_end timestamptz, p_buffer int, p_exclude uuid[])
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', e.end_at, 'flexibility', e.flexibility)
      order by e.start_at), '[]'::jsonb)
  from public.calendar_events e
  where e.user_id = auth.uid()
    and not (e.id = any (coalesce(p_exclude, '{}')))
    and e.start_at < p_end + make_interval(mins => p_buffer)
    and p_start < e.end_at + make_interval(mins => p_buffer);
$$;

create function public.create_event_checked(p_event jsonb, p_allow_overlap boolean, p_buffer int)
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
  insert into public.calendar_events (user_id, title, description, start_at, end_at, timezone, category, flexibility, location, reminder_minutes, task_id)
  values (auth.uid(), p_event ->> 'title', p_event ->> 'description', (p_event ->> 'startAt')::timestamptz, (p_event ->> 'endAt')::timestamptz,
          p_event ->> 'timezone', p_event ->> 'category', p_event ->> 'flexibility', p_event ->> 'location',
          (p_event ->> 'reminderMinutes')::int, (p_event ->> 'taskId')::uuid)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'event', to_jsonb(v_row));
end $$;

create function public.update_event_checked(p_id uuid, p_patch jsonb, p_expected_version int, p_allow_overlap boolean, p_buffer int)
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
    reminder_minutes = case when p_patch ? 'reminderMinutes' then (p_patch ->> 'reminderMinutes')::int else reminder_minutes end,
    completed_at = case when p_patch ? 'completedAt' then (p_patch ->> 'completedAt')::timestamptz else completed_at end,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'event', to_jsonb(v_row));
end $$;

-- p_moves: [{ "eventId": uuid, "expectedVersion": int, "start": ts, "end": ts }]
-- All-or-nothing: moves are applied, then the final state is checked; any conflict rolls back.
create function public.move_events_checked(p_moves jsonb, p_allow_overlap boolean, p_buffer int)
returns jsonb language plpgsql security invoker as $$
declare
  m jsonb;
  v_cur public.calendar_events;
  v_ids uuid[] := '{}';
  v_conflicts jsonb;
  v_rows jsonb;
  v_detail text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform public._lock_user_schedule();
  -- 1. verify every target exists and is unchanged before touching anything
  for m in select * from jsonb_array_elements(p_moves) loop
    select * into v_cur from public.calendar_events where id = (m ->> 'eventId')::uuid and user_id = auth.uid() for update;
    if not found then
      return jsonb_build_object('ok', false, 'notFound', true);
    end if;
    if v_cur.version <> (m ->> 'expectedVersion')::int then
      return jsonb_build_object('ok', false, 'versionConflict', true, 'current', to_jsonb(v_cur));
    end if;
    v_ids := v_ids || v_cur.id;
  end loop;
  -- 2. apply
  for m in select * from jsonb_array_elements(p_moves) loop
    update public.calendar_events
      set start_at = (m ->> 'start')::timestamptz, end_at = (m ->> 'end')::timestamptz, version = version + 1, updated_at = now()
      where id = (m ->> 'eventId')::uuid and user_id = auth.uid();
  end loop;
  if not p_allow_overlap then
    for m in select * from jsonb_array_elements(p_moves) loop
      v_conflicts := public._conflicts((m ->> 'start')::timestamptz, (m ->> 'end')::timestamptz, p_buffer, array[(m ->> 'eventId')::uuid]);
      if jsonb_array_length(v_conflicts) > 0 then
        raise exception using errcode = 'P0001', message = 'schedule_conflict', detail = v_conflicts::text;
      end if;
    end loop;
  end if;
  select jsonb_agg(to_jsonb(e)) into v_rows from public.calendar_events e where e.id = any (v_ids);
  return jsonb_build_object('ok', true, 'events', coalesce(v_rows, '[]'::jsonb));
exception
  when sqlstate 'P0001' then
    -- entering the handler rolls back every update made in this block
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'conflicts', coalesce(v_detail::jsonb, '[]'::jsonb));
end $$;
