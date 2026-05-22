-- name: RegisterPushToken :exec
INSERT INTO push_tokens (user_id, token)
VALUES ($1, $2)
ON CONFLICT (user_id, token) DO NOTHING;

-- name: DeletePushToken :exec
DELETE FROM push_tokens WHERE user_id = $1 AND token = $2;

-- name: GetPushTokensForUser :many
SELECT token FROM push_tokens WHERE user_id = $1;

-- name: GetPushTokensForUsers :many
SELECT token FROM push_tokens WHERE user_id = ANY($1::uuid[]);
