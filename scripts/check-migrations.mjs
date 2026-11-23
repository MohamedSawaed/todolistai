// Runs the Supabase migrations against an in-process Postgres with a stubbed `auth` schema,
// then exercises the scheduling functions and row-level security as two different users.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
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
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);

for (const f of ["0001_init.sql", "0002_event_reminders.sql"]) {
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

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
