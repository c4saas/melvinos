ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS website text;
