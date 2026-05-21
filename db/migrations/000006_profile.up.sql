CREATE TYPE game_preference AS ENUM ('EFOOTBALL', 'DLS', 'BOTH');

ALTER TABLE users
    ADD COLUMN avatar_url       TEXT,
    ADD COLUMN bio              VARCHAR(160),
    ADD COLUMN game_preference  game_preference NOT NULL DEFAULT 'BOTH';
