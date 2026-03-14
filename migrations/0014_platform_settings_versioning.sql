-- Add version tracking to platform_settings
ALTER TABLE "platform_settings"
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

-- Settings history table for rollback support
CREATE TABLE IF NOT EXISTS "platform_settings_history" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "version" integer NOT NULL,
    "data" jsonb NOT NULL,
    "changed_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
    "changed_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_settings_history_version_idx"
    ON "platform_settings_history" ("version" DESC);
