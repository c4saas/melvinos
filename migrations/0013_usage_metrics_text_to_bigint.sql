-- Migrate usage_metrics token columns from TEXT to BIGINT for proper numeric aggregation.
-- Safely cast existing text values to bigint; any non-numeric values default to 0.

ALTER TABLE "usage_metrics"
  ALTER COLUMN "prompt_tokens" SET DEFAULT 0,
  ALTER COLUMN "prompt_tokens" TYPE bigint USING CASE WHEN "prompt_tokens" ~ '^\d+$' THEN "prompt_tokens"::bigint ELSE 0 END;

ALTER TABLE "usage_metrics"
  ALTER COLUMN "completion_tokens" SET DEFAULT 0,
  ALTER COLUMN "completion_tokens" TYPE bigint USING CASE WHEN "completion_tokens" ~ '^\d+$' THEN "completion_tokens"::bigint ELSE 0 END;

ALTER TABLE "usage_metrics"
  ALTER COLUMN "total_tokens" SET DEFAULT 0,
  ALTER COLUMN "total_tokens" TYPE bigint USING CASE WHEN "total_tokens" ~ '^\d+$' THEN "total_tokens"::bigint ELSE 0 END;
