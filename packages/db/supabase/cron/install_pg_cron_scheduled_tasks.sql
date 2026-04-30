-- =============================================================================
-- Supabase: pg_cron + pg_net → POST /api/cron/scheduled-tasks (each minute)
-- =============================================================================
-- Prerequisites (Supabase Dashboard → Database → Extensions):
--   - pg_cron
--   - pg_net   (provides net.http_post)
--
-- Before running:
--   1. Deploy your Next.js app and set CRON_SECRET in the app environment.
--   2. Replace YOUR_PUBLIC_APP_ORIGIN below (no trailing slash), e.g.
--      https://your-app.vercel.app
--   3. Replace YOUR_CRON_SECRET with the exact same value as CRON_SECRET.
--   4. If a job with the same name exists, run: SELECT cron.unschedule('run-scheduled-tasks');
--
-- After this, enable the agent tool "Programar tarea" (schedule_task) per user
-- in Ajustes → Herramientas, and link Telegram for notifications.

SELECT cron.schedule(
  'run-scheduled-tasks',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://perish-jolt-village.ngrok-free.dev/api/cron/scheduled-tasks',
      headers := jsonb_build_object(
        'Authorization', 'Bearer 4de7c99183564784405eff34855adaea387c42b8c2111d996e4b7dcea4b9ebe7',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
