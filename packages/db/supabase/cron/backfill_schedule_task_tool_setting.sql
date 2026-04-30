-- Optional one-shot: ensure every profile has a user_tool_settings row for
-- schedule_task (disabled by default) so Ajustes shows the toggle consistently.
-- Run in Supabase SQL Editor as needed (safe to re-run).

INSERT INTO public.user_tool_settings (user_id, tool_id, enabled, config_json)
SELECT p.id, 'schedule_task', false, '{}'::jsonb
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_tool_settings u
  WHERE u.user_id = p.id
    AND u.tool_id = 'schedule_task'
);
