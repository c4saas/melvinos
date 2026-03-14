CREATE TABLE IF NOT EXISTS "usage_summary_snapshots" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" varchar NOT NULL,
    "range_start" timestamp NOT NULL,
    "range_end" timestamp NOT NULL,
    "totals" jsonb NOT NULL,
    "model_breakdown" jsonb NOT NULL,
    "generated_at" timestamp NOT NULL DEFAULT now(),
    CONSTRAINT "usage_summary_snapshots_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "usage_summary_snapshots_user_id_idx"
    ON "usage_summary_snapshots" ("user_id");

CREATE INDEX IF NOT EXISTS "usage_summary_snapshots_user_generated_at_idx"
    ON "usage_summary_snapshots" ("user_id", "generated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "usage_summary_snapshots_window_idx"
    ON "usage_summary_snapshots" ("user_id", "range_start", "range_end");
