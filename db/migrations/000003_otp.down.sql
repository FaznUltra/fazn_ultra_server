ALTER TABLE users
    DROP COLUMN IF EXISTS email_verified,
    DROP COLUMN IF EXISTS otp_code,
    DROP COLUMN IF EXISTS otp_expires_at;
