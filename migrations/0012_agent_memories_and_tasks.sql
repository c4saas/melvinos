-- Agent Memories table for persistent agent memory
CREATE TABLE IF NOT EXISTS "agent_memories" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "category" text NOT NULL,
    "content" text NOT NULL,
    "source" text,
    "relevance_score" integer DEFAULT 50,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_memories_category_idx"
    ON "agent_memories" ("category");

-- Agent Task Status enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_task_status') THEN
        CREATE TYPE "agent_task_status" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
    END IF;
END$$;

-- Agent Tasks table for background task queue
CREATE TABLE IF NOT EXISTS "agent_tasks" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "title" text NOT NULL,
    "status" "agent_task_status" NOT NULL DEFAULT 'pending',
    "input" jsonb,
    "output" jsonb,
    "error" text,
    "conversation_id" varchar,
    "progress" integer DEFAULT 0,
    "started_at" timestamp,
    "completed_at" timestamp,
    "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_tasks_status_idx"
    ON "agent_tasks" ("status");

CREATE INDEX IF NOT EXISTS "agent_tasks_conversation_idx"
    ON "agent_tasks" ("conversation_id");
