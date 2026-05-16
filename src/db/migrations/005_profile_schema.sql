-- Extend users with profile fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bio           TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url    TEXT,
  ADD COLUMN IF NOT EXISTS tags          TEXT[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS global_rank   INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_wins    INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_matches INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW();

-- Privacy settings (one row per user)
CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id                UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_online_status     BOOLEAN     NOT NULL DEFAULT TRUE,
  show_stats             BOOLEAN     NOT NULL DEFAULT TRUE,
  show_recent_results    BOOLEAN     NOT NULL DEFAULT TRUE,
  allow_challenges_from  TEXT        NOT NULL DEFAULT 'everyone'
                           CHECK (allow_challenges_from IN ('everyone', 'friends', 'nobody')),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Streaming channel connections
CREATE TABLE IF NOT EXISTS streaming_channels (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT        NOT NULL CHECK (provider IN ('youtube', 'twitch')),
  channel_id    TEXT        NOT NULL,
  channel_name  TEXT        NOT NULL,
  channel_url   TEXT        NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_streaming_channels_user ON streaming_channels (user_id);
CREATE INDEX IF NOT EXISTS idx_privacy_settings_user ON privacy_settings (user_id);
