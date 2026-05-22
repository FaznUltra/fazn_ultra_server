CREATE TYPE challenge_type AS ENUM ('PUBLIC', 'FRIENDS', 'DIRECT');

CREATE TYPE challenge_status AS ENUM (
    'OPEN',
    'ACCEPTED',
    'IN_PROGRESS',
    'AI_REVIEW',
    'VERDICT',
    'COMPLETED',
    'DISPUTED',
    'ADMIN_RESOLVED',
    'CANCELLED',
    'EXPIRED',
    'REFUNDED'
);

CREATE TYPE challenge_game AS ENUM ('EFOOTBALL', 'DLS');

CREATE TABLE challenges (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id              UUID NOT NULL REFERENCES users(id),
    opponent_id             UUID REFERENCES users(id),

    type                    challenge_type NOT NULL DEFAULT 'PUBLIC',
    game                    challenge_game NOT NULL,
    status                  challenge_status NOT NULL DEFAULT 'OPEN',
    stake_amount            BIGINT NOT NULL,

    -- Timing
    acceptance_deadline     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
    accepted_at             TIMESTAMPTZ,
    started_at              TIMESTAMPTZ,
    match_deadline          TIMESTAMPTZ, -- started_at + 90 minutes
    ended_at                TIMESTAMPTZ,

    -- Rejection tracking (cannot re-challenge rejected users)
    rejected_by             UUID[],

    -- Mux streaming
    creator_stream_key      TEXT,
    creator_playback_id     TEXT,
    opponent_stream_key     TEXT,
    opponent_playback_id    TEXT,
    creator_asset_id        TEXT, -- Mux stored recording
    opponent_asset_id       TEXT,

    -- Ready confirmation (both must confirm before IN_PROGRESS)
    creator_ready           BOOLEAN NOT NULL DEFAULT FALSE,
    opponent_ready          BOOLEAN NOT NULL DEFAULT FALSE,

    -- AI verdict
    ai_winner_id            UUID REFERENCES users(id),
    ai_score                TEXT,
    ai_confidence           NUMERIC(5,2),
    verdict_at              TIMESTAMPTZ,
    dispute_deadline        TIMESTAMPTZ, -- verdict_at + 1 hour

    -- Dispute
    disputed_by             UUID REFERENCES users(id),
    dispute_reason          TEXT,
    disputed_at             TIMESTAMPTZ,

    -- Admin resolution
    resolved_by             UUID REFERENCES users(id),
    resolution_note         TEXT,
    resolved_at             TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_challenges_status      ON challenges (status);
CREATE INDEX idx_challenges_creator     ON challenges (creator_id);
CREATE INDEX idx_challenges_opponent    ON challenges (opponent_id);
CREATE INDEX idx_challenges_open_lobby  ON challenges (status, type, created_at DESC)
    WHERE status = 'OPEN';
