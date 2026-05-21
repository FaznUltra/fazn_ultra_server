-- name: CreateUser :one
INSERT INTO users (first_name, last_name, username, email, password_hash, google_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1 LIMIT 1;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = $1 LIMIT 1;

-- name: GetUserByGoogleID :one
SELECT * FROM users WHERE google_id = $1 LIMIT 1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1 LIMIT 1;

-- name: UsernameExists :one
SELECT EXISTS(SELECT 1 FROM users WHERE username = $1) AS exists;

-- name: SetOTP :exec
UPDATE users SET otp_code = $2, otp_expires_at = $3 WHERE id = $1;

-- name: VerifyEmailOTP :one
UPDATE users
SET email_verified = TRUE, otp_code = NULL, otp_expires_at = NULL
WHERE email = $1
  AND otp_code = $2
  AND otp_expires_at > NOW()
RETURNING *;

-- name: SetEmailVerified :exec
UPDATE users SET email_verified = TRUE, otp_code = NULL, otp_expires_at = NULL WHERE id = $1;
