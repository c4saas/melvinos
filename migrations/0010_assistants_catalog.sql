DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'assistant_type'
  ) THEN
    CREATE TYPE assistant_type AS ENUM ('prompt', 'webhook');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "assistants" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" assistant_type NOT NULL DEFAULT 'prompt',
  "user_id" varchar REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "prompt_content" text,
  "webhook_url" text,
  "workflow_id" text,
  "metadata" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "assistants_user_id_idx" ON "assistants" ("user_id");
CREATE INDEX IF NOT EXISTS "assistants_type_idx" ON "assistants" ("type");
CREATE INDEX IF NOT EXISTS "assistants_active_idx" ON "assistants" ("is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "assistants_user_workflow_idx" ON "assistants" ("user_id", "workflow_id");

DO $$
DECLARE
  record_exists boolean;
BEGIN
  SELECT to_regclass('public.experts') IS NOT NULL INTO record_exists;
  IF record_exists THEN
    INSERT INTO "assistants" (
      "id",
      "type",
      "user_id",
      "name",
      "description",
      "prompt_content",
      "metadata",
      "is_active",
      "created_at",
      "updated_at"
    )
    SELECT
      src.id,
      'prompt',
      NULLIF(src.payload ->> 'user_id', '')::varchar,
      COALESCE(NULLIF(src.payload ->> 'name', ''), 'Untitled Assistant'),
      NULLIF(src.payload ->> 'description', ''),
      NULLIF(COALESCE(src.payload ->> 'prompt_content', src.payload ->> 'prompt'), ''),
      (src.payload -> 'metadata')::jsonb,
      COALESCE((src.payload ->> 'is_active')::boolean, true),
      COALESCE((src.payload ->> 'created_at')::timestamp, now()),
      COALESCE((src.payload ->> 'updated_at')::timestamp, now())
    FROM (
      SELECT e.id, to_jsonb(e.*) AS payload FROM experts e
    ) AS src
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DO $$
DECLARE
  record_exists boolean;
BEGIN
  SELECT to_regclass('public.n8n_agents') IS NOT NULL INTO record_exists;
  IF record_exists THEN
    INSERT INTO "assistants" (
      "id",
      "type",
      "user_id",
      "name",
      "description",
      "prompt_content",
      "webhook_url",
      "workflow_id",
      "metadata",
      "is_active",
      "created_at",
      "updated_at"
    )
    SELECT
      src.id,
      'webhook',
      NULLIF(src.payload ->> 'user_id', '')::varchar,
      COALESCE(src.payload ->> 'name', 'Workflow Assistant'),
      NULLIF(src.payload ->> 'description', ''),
      NULL,
      NULLIF(src.payload ->> 'webhook_url', ''),
      NULLIF(src.payload ->> 'workflow_id', ''),
      (src.payload -> 'metadata')::jsonb,
      CASE
        WHEN lower(COALESCE(src.payload ->> 'status', 'inactive')) = 'active' THEN true
        ELSE false
      END,
      COALESCE((src.payload ->> 'created_at')::timestamp, now()),
      COALESCE((src.payload ->> 'updated_at')::timestamp, now())
    FROM (
      SELECT a.id, to_jsonb(a.*) AS payload FROM n8n_agents a
    ) AS src
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

ALTER TABLE IF EXISTS "releases" RENAME COLUMN "expert_ids" TO "assistant_ids";
ALTER TABLE IF EXISTS "releases" ALTER COLUMN "assistant_ids" SET DEFAULT '[]'::jsonb;
UPDATE "releases" SET "assistant_ids" = '[]'::jsonb WHERE "assistant_ids" IS NULL;

DROP TABLE IF EXISTS "experts";
DROP TABLE IF EXISTS "n8n_agents";
