-- Tool Error Logs table for persistent tool failure tracking
CREATE TABLE IF NOT EXISTS "tool_error_logs" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "tool_name" text NOT NULL,
    "error" text NOT NULL,
    "args" jsonb,
    "conversation_id" varchar,
    "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tool_error_logs_created_idx"
    ON "tool_error_logs" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "tool_error_logs_tool_name_idx"
    ON "tool_error_logs" ("tool_name");
