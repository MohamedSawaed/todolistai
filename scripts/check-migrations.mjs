// Runs the Supabase migrations against an in-process Postgres with a stubbed `auth` schema,
// then exercises the scheduling functions and row-level security as two different users.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";

// Usage: npm run test:db   (verifies supabase/migrations without a real Supabase project)
const dir = process.argv[2] ?? fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const db = new PGlite();
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated;
  create role anon;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);

for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  let sql = readFileSync(`${dir}/${f}`, "utf8");
  sql = sql.replace(/create extension if not exists pgcrypto;/, ""); // gen_random_uuid is built in
  try { await db.exec(sql); ok(true, `migration ${f} applied`); }
  catch (e) { ok(false, `migration ${f}: ${e.message}`); process.exit(1); }
}

// Supabase grants these to the API role
await db.exec(`
  grant usage on schema public to authenticated;
  grant all on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  insert into auth.users (id, raw_user_meta_data) values ('${A}', '{"full_name":"Alice"}'), ('${B}', '{}');
`);
ok((await db.query(`select display_name from profiles where id='${A}'`)).rows[0]?.display_name === "Alice", "profile auto-created on sign-up");

const as = async (user, sql, params) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role;"); }
};
const ev = (title, s, e, extra = {}) => JSON.stringify({ title, startAt: s, endAt: e, timezone: "UTC", category: "work", flexibility: "flexible", description: null, location: null, reminders: [1440, 120], taskId: null, ...extra });

const r1 = (await as(A, `select create_event_checked($1::jsonb, false, 0) as r`, [ev("Team Meeting", "2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z")]))[0].r;
ok(r1.ok === true && JSON.stringify(r1.event.reminders) === "[1440,120]", "create event with two reminders");
const meetingId = r1.event.id;

const r2 = (await as(A, `select create_event_checked($1::jsonb, false, 0) as r`, [ev("Gym", "2027-01-12T18:30:00Z", "2027-01-12T19:30:00Z")]))[0].r;
ok(r2.ok === false && r2.conflicts[0].title === "Team Meeting", "overlap rejected with conflict details");

const r3 = (await as(A, `select create_event_checked($1::jsonb, true, 0) as r`, [ev("Gym", "2027-01-12T18:30:00Z", "2027-01-12T19:30:00Z")]))[0].r;
ok(r3.ok === true, "overlap allowed when the user accepts it");
const gymId = r3.event.id;

const r4 = (await as(A, `select update_event_checked($1, $2::jsonb, 1, false, 0) as r`, [meetingId, JSON.stringify({ reminders: [10] })]))[0].r;
ok(r4.ok === true && JSON.stringify(r4.event.reminders) === "[10]" && r4.event.version === 2, "update reminders bumps version");
const r5 = (await as(A, `select update_event_checked($1, $2::jsonb, 1, false, 0) as r`, [meetingId, JSON.stringify({ title: "x" })]))[0].r;
ok(r5.ok === false && r5.versionConflict === true, "stale version rejected");

// move: free slot, then a move that would collide must roll back
const r6 = (await as(A, `select move_events_checked($1::jsonb, false, 0) as r`, [JSON.stringify([{ eventId: gymId, expectedVersion: 1, start: "2027-01-12T08:00:00Z", end: "2027-01-12T09:00:00Z" }])]))[0].r;
ok(r6.ok === true, "move to a free slot");
const r7 = (await as(A, `select move_events_checked($1::jsonb, false, 0) as r`, [JSON.stringify([{ eventId: gymId, expectedVersion: 2, start: "2027-01-12T18:15:00Z", end: "2027-01-12T18:45:00Z" }])]))[0].r;
const gymAfter = (await as(A, `select start_at, version from calendar_events where id=$1`, [gymId]))[0];
ok(r7.ok === false && r7.conflicts?.length > 0 && gymAfter.version === 2, "colliding move rolled back, conflicts reported");

// row-level security
ok((await as(B, `select * from calendar_events`)).length === 0, "user B cannot see user A's events");
const del = await as(B, `delete from calendar_events where id=$1 returning id`, [meetingId]);
ok(del.length === 0, "user B cannot delete user A's events");
const rb = (await as(B, `select update_event_checked($1, '{"title":"hacked"}'::jsonb, null, true, 0) as r`, [meetingId]))[0].r;
ok(rb.ok === false && rb.notFound === true, "user B cannot update user A's event via function");
let blocked = false;
try { await as(B, `insert into calendar_events (user_id, title, start_at, end_at, timezone) values ('${A}', 'x', now(), now() + interval '1 hour', 'UTC')`); } catch { blocked = true; }
ok(blocked, "user B cannot insert rows owned by user A");
const t = (await as(A, `insert into tasks (title) values ('Mine') returning id`))[0].id;
let fk = false;
try { await as(B, `select create_event_checked($1::jsonb, true, 0)`, [ev("x", "2027-02-01T10:00:00Z", "2027-02-01T11:00:00Z", { taskId: t })]); } catch { fk = true; }
ok(fk, "user B cannot link an event to user A's task");
let anon = false;
try { await db.exec("select set_config('request.jwt.claim.sub', '', false)"); await db.query(`select create_event_checked($1::jsonb, true, 0)`, [ev("x", "2027-02-01T10:00:00Z", "2027-02-01T11:00:00Z")]); } catch { anon = true; }
ok(anon, "signed-out caller is refused");

// ---------------------------------------------------------------- push notifications
const SECRET = "test-secret";
await db.exec(`insert into private.app_config (key, value) values ('dispatch_secret', '${SECRET}');`);
// A turns on phone notifications (briefing time 00:00 local is "now" only near midnight, so use the current local time)
const nowLocal = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
await db.exec(`update profiles set timezone = 'Asia/Jerusalem',
  preferences = '{"clock":"24h","notifications":{"browser":true,"morningBriefing":true,"briefingTime":"${nowLocal}"}}' where id = '${A}'`);
await as(A, `select save_push_subscription('https://push.example/device-1', 'p256', 'authkey', 'test')`);
// an event whose 60-minute reminder is due right now, and one that isn't due yet
const soon = new Date(Date.now() + 59 * 60000).toISOString();
const later = new Date(Date.now() + 5 * 3600000).toISOString();
await as(A, `select create_event_checked($1::jsonb, true, 0)`, [ev("Dentist", soon, new Date(Date.parse(soon) + 3600000).toISOString(), { reminders: [1440, 60] })]);
await as(A, `select create_event_checked($1::jsonb, true, 0)`, [ev("Later thing", later, new Date(Date.parse(later) + 3600000).toISOString(), { reminders: [15] })]);

let bad = false;
try { await db.query(`select * from claim_due_notifications('wrong')`); } catch { bad = true; }
ok(bad, "dispatch refuses a wrong secret");

await db.exec(`set role anon;`);
const first = (await db.query(`select * from claim_due_notifications($1)`, [SECRET])).rows;
await db.exec(`reset role;`);
const dentist = first.filter((n) => n.item_title === "Dentist" && n.kind === "event");
ok(dentist.length === 1 && dentist[0].endpoint === "https://push.example/device-1" && dentist[0].kind === "event" && dentist[0].minutes === 60 && dentist[0].tz === "Asia/Jerusalem", `due event reminder is sent with its facts (${dentist[0]?.kind} ${dentist[0]?.minutes} min)`);
ok(!first.some((n) => n.item_title === "Later thing" && n.kind === "event"), "reminders that aren't due yet are not sent");
const brief = first.filter((n) => n.kind === "briefing");
ok(brief.length === 1 && brief[0].n_events >= 1 && brief[0].locale === "en", `morning briefing sent at the chosen time (${brief[0]?.n_events} events)`);
const second = (await db.query(`select * from claim_due_notifications($1)`, [SECRET])).rows;
ok(second.length === 0, "nothing is sent twice");
ok((await as(B, `select * from push_subscriptions`)).length === 0, "user B cannot see user A's devices");

// follow-up dismissal goes through the checked update
const pastId = (await as(A, `select (create_event_checked($1::jsonb, true, 0) -> 'event' ->> 'id') as id`, [ev("Old task", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z")]))[0].id;
const dis = (await as(A, `select update_event_checked($1, $2::jsonb, null, false, 0) as r`, [pastId, JSON.stringify({ followUpDismissedAt: new Date().toISOString() })]))[0].r;
ok(dis.ok === true && dis.event.followup_dismissed_at !== null, "follow-up can be dismissed");

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
