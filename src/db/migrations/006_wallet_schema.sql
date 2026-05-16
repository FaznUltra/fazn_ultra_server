-- ─── Auto-create a wallet for every new user ──────────────────────────────────
CREATE OR REPLACE FUNCTION create_wallet_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO wallets (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_wallet ON users;
CREATE TRIGGER trg_create_wallet
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION create_wallet_for_new_user();

-- Back-fill: create wallets for any existing users that don't have one
INSERT INTO wallets (user_id)
SELECT id FROM users
WHERE id NOT IN (SELECT user_id FROM wallets)
ON CONFLICT DO NOTHING;

-- ─── Transactions ledger ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'top_up','withdrawal','challenge_entry',
                'challenge_win','gift_sent','gift_received','platform_bonus'
              )),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','completed','failed','reversed')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL DEFAULT '',
  reference   TEXT NOT NULL UNIQUE,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions (reference);

-- ─── Paystack events log (idempotent webhook handling) ────────────────────────
CREATE TABLE IF NOT EXISTS paystack_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   TEXT NOT NULL UNIQUE,   -- Paystack event identifier
  event_type TEXT NOT NULL,
  payload    JSONB NOT NULL,
  processed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
