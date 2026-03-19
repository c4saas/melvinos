-- Add timezone field to cron_jobs so new expressions fire at the correct local time
-- Existing jobs keep UTC (their cron expressions were already written with UTC offset)
ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS timezone VARCHAR DEFAULT 'UTC';
