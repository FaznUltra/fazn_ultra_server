ALTER TABLE users
    ADD COLUMN email_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN otp_code        TEXT,
    ADD COLUMN otp_expires_at  TIMESTAMPTZ;
