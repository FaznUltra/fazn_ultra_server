ALTER TABLE games DROP COLUMN IF EXISTS platform;

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS slug         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS category     TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS platforms    TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS score_type   TEXT NOT NULL DEFAULT 'numeric' CHECK (score_type IN ('numeric', 'win_loss', 'time'));

CREATE INDEX IF NOT EXISTS idx_games_slug ON games (slug);
CREATE INDEX IF NOT EXISTS idx_games_category ON games (category);
