-- Patch proposals: Melvin proposes code fixes, Austin approves via SMS, Claude Code applies them

CREATE TABLE IF NOT EXISTS patch_proposals (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code        VARCHAR(8) NOT NULL UNIQUE,          -- short approval code e.g. "FX7K2M"
  status      VARCHAR NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | applied | failed
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  claude_prompt TEXT NOT NULL,                     -- prompt sent to Claude Code relay to apply the fix
  workdir     VARCHAR NOT NULL DEFAULT '/opt/melvinos',
  proposed_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  applied_at  TIMESTAMP,
  apply_output TEXT,
  error       TEXT
);
