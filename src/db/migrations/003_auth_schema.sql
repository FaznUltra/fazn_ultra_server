-- Drop Clerk-specific column
ALTER TABLE users DROP COLUMN IF EXISTS clerk_user_id;

-- Add new auth columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_name     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS password_hash  TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auth_provider  TEXT NOT NULL DEFAULT 'local'
    CHECK (auth_provider IN ('local', 'google', 'apple')),
  ADD COLUMN IF NOT EXISTS provider_id    TEXT;

-- Unique constraint: one provider_id per provider
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider
  ON users (auth_provider, provider_id)
  WHERE provider_id IS NOT NULL;

-- Drop old index that referenced clerk_user_id (if it still exists)
DROP INDEX IF EXISTS idx_users_clerk_id;
