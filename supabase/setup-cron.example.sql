-- Run once in the Supabase SQL Editor AFTER the migrations, with your own values:
--   YOUR_APP_URL   e.g. https://todolistai-rho.vercel.app
--   YOUR_SECRET    the same value as CRON_SECRET in Vercel (a long random string)
-- It stores the secret privately and calls the app every minute to send due reminders.

create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into private.app_config (key, value) values ('dispatch_secret', 'YOUR_SECRET')
on conflict (key) do update set value = excluded.value;

select cron.unschedule(jobid) from cron.job where jobname = 'tempo-reminders';

select cron.schedule(
  'tempo-reminders',
  '* * * * *',
  $$ select net.http_post(
       url := 'YOUR_APP_URL/api/push/dispatch',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', (select value from private.app_config where key = 'dispatch_secret')),
       body := '{}'::jsonb,
       timeout_milliseconds := 20000
     ) $$
);
