# PlanMind — AI calendar & to-do assistant

*Your time, intelligently organized.* PlanMind combines a calendar, a task manager, notes and a
conversational planning assistant. The assistant reads your real schedule, finds free time,
detects conflicts, and **proposes** changes that you confirm. It never writes on its own.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add keys (see below)
npm run dev                  # http://localhost:3000
```

With no configuration the app runs in **Local mode**. It has one implicit user, and its data
is stored in `.data/tempo-local.json` on the server machine. The UI labels this mode clearly.
Everything except the AI assistant works in Local mode.

| Capability | Requires |
|---|---|
| Calendar, tasks, notes, reminders, conflict checks, drag-and-drop | nothing |
| AI assistant | `ANTHROPIC_API_KEY` |
| Accounts, email / Google sign-in, Postgres with row-level security | Supabase env vars + migration |

### Enable the AI assistant
1. Create an API key at <https://platform.claude.com>.
2. Set `ANTHROPIC_API_KEY` in `.env.local` and restart the server.

The model is `claude-opus-5-5` with adaptive thinking and server-side refusal fallback. You can
override it with `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT`. The key is only ever read on the server.

### Enable Supabase (accounts + Postgres)
1. Create a Supabase project.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor, or use `supabase db push`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. In Auth → URL configuration, add `http://localhost:3000/auth/callback` (and your production URL).
5. Optional: enable the Google provider, then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.

When Supabase is configured, signed-out visitors are sent to `/welcome` (onboarding → account).

## Deploy online (Vercel + Supabase, both free)

This gives you an `https://…vercel.app` link that works on any device, with accounts and data
saved in the cloud. A secure link is also what phones require before they allow installing the
app and showing notifications.

**1. Database (Supabase)**
1. Sign in at <https://supabase.com> → **New project**. Pick a region near you and save the database password.
2. Open **SQL Editor** → **New query**. Paste all of `supabase/migrations/0001_init.sql` → **Run**.
   Then do the same with `0002_event_reminders.sql`.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

**2. Hosting (Vercel)**
1. Sign in at <https://vercel.com> with your GitHub account → **Add New… → Project** → import `todolistai`.
2. Before clicking Deploy, open **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL`: the Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the anon key
   - `ANTHROPIC_API_KEY`: your Claude API key
3. Click **Deploy** and copy your app link, e.g. `https://todolistai.vercel.app`.

**3. Connect sign-in to your link (Supabase)**
- **Authentication → URL Configuration**: set **Site URL** to your Vercel link, and add
  `https://YOUR-LINK.vercel.app/auth/callback` under **Redirect URLs**.

**4. Install on your phone**
- Open your link → create an account.
- **iPhone (Safari):** Share → **Add to Home Screen**. **Android (Chrome):** ⋮ → **Install app** / **Add to Home screen**.

**5. Notifications while the app is closed (web push)**
1. Generate keys once: `npx web-push generate-vapid-keys`, and pick a long random `CRON_SECRET`.
2. In Vercel add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Config), `VAPID_PRIVATE_KEY` (Secret) and
   `CRON_SECRET` (Secret), then redeploy.
3. In Supabase run `supabase/migrations/0003_push_and_followups.sql`, then
   `supabase/setup-cron.example.sql` with your app URL and the same `CRON_SECRET`. This
   creates a timer that calls `/api/push/dispatch` every minute.
4. In PlanMind → Settings, turn on **Phone notifications** and tap **Send a test notification**.

**6. Later database updates.** Run each newer file in `supabase/migrations` once, in order:
`0004_localized_notifications.sql` (notifications in each user's language, evening review) and
`0005_capture_source.sql` (keeps where an imported event came from) and `0006_life_aware.sql`
(one-tap action details, preparation links, recorded activity time, notification rules).

Every push to `main` on GitHub redeploys automatically. If you change a `NEXT_PUBLIC_*`
variable, redeploy so the new value is built in. `npm run test:db` checks the SQL migrations
against a local Postgres without needing a Supabase project.

## Scripts
- `npm run dev` / `npm run build` / `npm start`
- `npm test`: Vitest suite (engine, timezones/DST, AI validation, confirmations, authorization, concurrency, assistant loop)
- `npm run typecheck`, `npm run lint`

> Windows note: run the tests from a path whose drive letter has its real casing (`C:\…`, not `c:\…`).
> If the casing is wrong, Vitest loads two copies of itself and every suite fails with "failed to find the current suite".

## Architecture

```
src/lib/
  scheduling/engine.ts   Deterministic engine: overlaps (half-open), buffers, free-slot search,
                         alternatives, overlap layout. Pure functions, Luxon for zones/DST.
  scheduling/time.ts     Local wall-clock ⇄ UTC conversion, day bounds (23h/25h DST days)
  schemas.ts             Zod schemas for every input; preference defaults
  data/repository.ts     Repository interface. Every instance is bound to one user.
  data/local-repo.ts     JSON-file / in-memory store with a write mutex (Local mode, tests)
  data/supabase-repo.ts  Postgres via Supabase (RLS + SECURITY INVOKER functions)
  services/proposals.ts  Proposal lifecycle: create → confirm (re-validate, atomic, idempotent) → undo
  services/scheduling.ts Conflict analysis + real alternative slots for a requested interval
  ai/tools.ts            Tool schemas (Zod → JSON Schema) and handlers; write tools only create proposals
  ai/assistant.ts        Claude tool loop; transcript stored verbatim and replayed append-only
  ai/prompt.ts           Stable system prompt; per-turn context block (local time, preferences)
src/app/api/*            Route handlers (auth via requireSession, domain errors → HTTP)
src/components/*         UI: app shell, composer, event details, chat + proposal cards, calendar grid
supabase/migrations      Schema, RLS policies, locked check-then-write functions
```

### Safety model
- **The model never decides availability.** `check_availability`, `find_free_slots` and every
  proposal go through the engine over stored events. Alternatives shown on cards come from the engine.
- **Proposals, not writes.** Write tools only create rows in `ai_action_proposals`. Confirming
  re-validates against current data inside a locked transaction: a per-user advisory lock in
  Postgres, or a mutex in Local mode. Stale data, meaning an event that changed since it was
  proposed, is rejected by its version number. A proposal can be applied only once, because the
  status moves from pending to applying with a compare-and-set (idempotency).
- **Multi-event reorganizations are all-or-nothing.** The final arrangement is checked as a whole.
- **Overlaps are a user choice.** Conflicts are reported with alternatives. "Add anyway" is explicit.
- **Authorization.** Every repository is scoped to the authenticated user. RLS enforces the same
  rule again in Postgres, and composite foreign keys stop a row from referencing another user's
  task or event.
- **Prompt-injection hygiene.** Event, task and note text is passed to the model as data. The
  system prompt tells it to ignore instructions inside that text. Tool inputs are validated with
  Zod, and ids are resolved through the user-scoped repository.
- **Minimal context.** The model receives only what its tool calls fetch, not the whole database.
- **Reminders** come only from saved events and tasks, never from pending proposals.

### Universal Capture (import from messages, screenshots, photos, PDFs)
- **Entry points:** the paperclip in the assistant's composer (upload screenshot, take photo,
  upload PDF, paste text), pasting an image into the chat, drag-and-drop on desktop, and
  **Share → PlanMind** on Android. The installed web app registers a Web Share Target
  (`manifest.ts` → `public/sw.js`). iOS doesn't offer share targets to web apps, so iPhone users
  upload or paste instead.
- **Pipeline:** `api/capture` checks size and type by file signature, rejects protected or very long
  PDFs, and sends the content to Claude (vision / PDF / text) with a structured-output schema
  (`lib/ai/capture.ts`). The model only *describes* what it read. `lib/capture/process.ts` validates
  every field, resolves dates in the right timezone (including DST and events that cross midnight),
  and decides what's pre-selected. `services/capture.ts` checks the real calendar for conflicts,
  alternatives, duplicates and overlaps inside the batch.
- **Saving:** one confirmation saves all selected items through the same locked checked writes as
  everything else. It re-checks conflicts and duplicates at save time and records an outcome per
  item (added / updated / skipped / needs attention / failed). Retries never create an item twice.
- **Privacy:** files are processed in memory and never stored. Only a short quote per item is kept
  for review, and it is dropped when the import is finished or discarded. Imported events keep a
  `source` (label + quote) that the user can remove from the event's details. Shared content is
  treated as untrusted data: instructions inside it are ignored and can't trigger any action.

### Life-aware assistant (before → during → after)
- **Now/Next card** (`lib/life/now.ts`): the most relevant activity from real data. Past activities
  are never assumed done — they become "Did it happen?".
- **One-tap actions** (`lib/life/actions.ts`): call, join meeting, directions, open link, view task —
  only from details the user saved (phone, https link, location, linked task). Nothing is guessed.
- **Preparation** (`lib/life/preparation.ts`): interviews, exams, presentations and trips (EN/AR/HE)
  get an offer to reserve time before them; the slot comes from the scheduling engine and is saved
  only after confirmation, linked with `prep_for`.
- **Personal time** (`lib/life/durations.ts`, `activity_sessions`): a Start / Pause / Finish timer and
  manual logging. Only user-confirmed time counts; statistics are a median of recent sessions with
  outliers set aside, from 4 sessions up. History can be viewed, corrected and deleted in Settings.
- **Reality Check** (`lib/life/reality.ts`): overlaps (confirmed), back-to-back activities in different
  places (estimate — no routing provider is connected, so travel time is never stated), sleep-time
  activities (preference), very full days and close deadlines without planned time.
- **Future Simulator** (`lib/life/simulator.ts`, AI tool `simulate_calendar_changes`): expands a
  recurring commitment in the user's timezone, finds conflicts, moves only flexible events into free
  time and compares free evenings/hours. It is a pure function over a snapshot; applying re-runs it on
  the live calendar and writes nothing if the result changed, with a compensating rollback on failure.
- **Life Modes** (`lib/life/modes.ts`): Exam, Busy Workweek, Travel, Project — shape the assistant's
  context, preparation ranking, Reality Check thresholds and notifications; never move events.
- **Notifications** (0006): per-category switches, quiet hours, at most 6 per 15 minutes, exactly-once
  delivery, and deep links that open the activity. Preparation and Reality Check appear in the app
  (not as push) to keep notifications to what's essential.

### Data model notes
- Timed events store UTC `timestamptz` plus the IANA `timezone` they were created in. The UI
  shows times in the user's current timezone.
- A task's due date, its work sessions (`calendar_events.task_id`, many per task) and its
  completion status are independent. Completing a session doesn't complete the task.
- Preferences live in `profiles.preferences` (JSONB, validated with Zod).

## Status and next steps
Implemented: Today dashboard, day/week/month calendar with click-to-create, validated
drag-and-drop and a now-indicator. Also: manual events, tasks (with subtasks) and notes; conflict
handling with real alternatives; and the AI assistant with confirmable cards for create, move,
delete, reorganize, task and note actions, with undo. Plus in-app and browser reminders,
onboarding, settings, dark mode, an RTL layout, keyboard shortcuts and reduced-motion support.

Suggested next steps:
1. **Recurring events.** Add an RRULE column and expand occurrences in `listEvents` and the engine.
2. **Full Arabic and Hebrew translations.** The layout already runs RTL. Fill in `src/lib/i18n.ts`.
3. **Push reminders when the app is closed.** Add a service worker with Web Push, plus a
   scheduled job (Supabase cron) that reads due reminders.
4. **Streaming assistant replies.** Use `messages.stream()` for token-by-token text.
5. **Touch drag-and-drop.** Add long-press to drag on mobile. Today, mobile users tap an event
   and then edit it.
6. **Supabase integration tests.** Run the repository suite against a local Supabase
   (`supabase start`) to exercise the SQL functions and RLS.
