CREATE TABLE wallets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    available_balance   BIGINT NOT NULL DEFAULT 0,
    locked_balance      BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bank_accounts (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    bank_name               TEXT NOT NULL,
    bank_code               TEXT NOT NULL,
    account_number          TEXT NOT NULL,
    account_name            TEXT NOT NULL,
    paystack_recipient_code TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE transaction_type AS ENUM (
    'DEPOSIT',
    'WITHDRAWAL',
    'CHALLENGE_STAKE',
    'CHALLENGE_REFUND',
    'CHALLENGE_WINNINGS',
    'PLATFORM_FEE',
    'TOURNAMENT_ENTRY',
    'TOURNAMENT_WINNINGS',
    'DISPUTE_FREEZE',
    'ADMIN_CREDIT',
    'ADMIN_DEBIT'
);

CREATE TYPE transaction_status AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED',
    'UNDER_REVIEW'
);

CREATE TABLE transactions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        transaction_type NOT NULL,
    amount      BIGINT NOT NULL,
    status      transaction_status NOT NULL DEFAULT 'PENDING',
    reference   TEXT NOT NULL UNIQUE,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user_id   ON transactions (user_id);
CREATE INDEX idx_transactions_type      ON transactions (user_id, type);
CREATE INDEX idx_transactions_created   ON transactions (user_id, created_at DESC);
CREATE INDEX idx_transactions_reference ON transactions (reference);
