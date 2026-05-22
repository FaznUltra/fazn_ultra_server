-- name: SendFriendRequest :one
INSERT INTO friendships (requester_id, addressee_id)
VALUES ($1, $2)
RETURNING *;

-- name: AcceptFriendRequest :one
UPDATE friendships
SET status = 'ACCEPTED', updated_at = NOW()
WHERE requester_id = $1 AND addressee_id = $2 AND status = 'PENDING'
RETURNING *;

-- name: DeclineFriendRequest :one
UPDATE friendships
SET status = 'DECLINED', updated_at = NOW()
WHERE requester_id = $1 AND addressee_id = $2 AND status = 'PENDING'
RETURNING *;

-- name: RemoveFriend :exec
DELETE FROM friendships
WHERE (requester_id = $1 AND addressee_id = $2)
   OR (requester_id = $2 AND addressee_id = $1);

-- name: GetFriendIDs :many
SELECT (CASE
    WHEN requester_id = $1 THEN addressee_id
    ELSE requester_id
END)::uuid AS friend_id
FROM friendships
WHERE (requester_id = $1 OR addressee_id = $1)
  AND status = 'ACCEPTED';

-- name: GetFriends :many
SELECT
    u.id, u.username, u.first_name, u.last_name, u.avatar_url,
    u.game_preference, u.last_seen_at
FROM friendships f
JOIN users u ON (
    CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END = u.id
)
WHERE (f.requester_id = $1 OR f.addressee_id = $1)
  AND f.status = 'ACCEPTED'
ORDER BY u.username ASC;

-- name: GetPendingRequests :many
SELECT
    u.id, u.username, u.first_name, u.last_name, u.avatar_url,
    u.game_preference, u.last_seen_at,
    f.created_at AS requested_at
FROM friendships f
JOIN users u ON f.requester_id = u.id
WHERE f.addressee_id = $1 AND f.status = 'PENDING'
ORDER BY f.created_at DESC;

-- name: GetFriendshipBetween :one
SELECT * FROM friendships
WHERE (requester_id = $1 AND addressee_id = $2)
   OR (requester_id = $2 AND addressee_id = $1)
LIMIT 1;

-- name: UpdateLastSeen :exec
UPDATE users SET last_seen_at = NOW() WHERE id = $1;
