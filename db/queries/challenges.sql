-- name: CreateChallenge :one
INSERT INTO challenges (creator_id, type, game, stake_amount, opponent_id, acceptance_deadline)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetChallengeByID :one
SELECT * FROM challenges WHERE id = $1 LIMIT 1;

-- name: GetOpenLobby :many
SELECT * FROM challenges
WHERE status = 'OPEN'
  AND acceptance_deadline > NOW()
  AND (
    type = 'PUBLIC'
    OR (type = 'FRIENDS' AND creator_id = ANY($1::uuid[]))
  )
  AND ($2::challenge_game IS NULL OR game = $2)
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;

-- name: GetMyChallenges :many
SELECT * FROM challenges
WHERE creator_id = $1 OR opponent_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: AcceptChallenge :one
UPDATE challenges
SET status = 'ACCEPTED',
    opponent_id = $2,
    accepted_at = NOW(),
    updated_at = NOW()
WHERE id = $1
  AND status = 'OPEN'
  AND acceptance_deadline > NOW()
  AND creator_id != $2
  AND NOT ($2 = ANY(COALESCE(rejected_by, '{}'::uuid[])))
RETURNING *;

-- name: SetCreatorReady :one
UPDATE challenges
SET creator_ready = TRUE, updated_at = NOW()
WHERE id = $1 AND creator_id = $2 AND status = 'ACCEPTED'
RETURNING *;

-- name: SetOpponentReady :one
UPDATE challenges
SET opponent_ready = TRUE, updated_at = NOW()
WHERE id = $1 AND opponent_id = $2 AND status = 'ACCEPTED'
RETURNING *;

-- name: StartChallenge :one
UPDATE challenges
SET status = 'IN_PROGRESS',
    started_at = NOW(),
    match_deadline = NOW() + INTERVAL '90 minutes',
    updated_at = NOW()
WHERE id = $1
  AND status = 'ACCEPTED'
  AND creator_ready = TRUE
  AND opponent_ready = TRUE
  AND creator_stream_key IS NOT NULL
  AND opponent_stream_key IS NOT NULL
RETURNING *;

-- name: SetMuxStreams :one
UPDATE challenges
SET creator_stream_key  = $2,
    creator_playback_id = $3,
    opponent_stream_key = $4,
    opponent_playback_id = $5,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: SetCreatorAsset :exec
UPDATE challenges SET creator_asset_id = $2, updated_at = NOW() WHERE id = $1;

-- name: SetOpponentAsset :exec
UPDATE challenges SET opponent_asset_id = $2, updated_at = NOW() WHERE id = $1;

-- name: SubmitVerdict :one
UPDATE challenges
SET status = 'VERDICT',
    ai_winner_id = $2,
    ai_score = $3,
    ai_confidence = $4,
    verdict_at = NOW(),
    dispute_deadline = NOW() + INTERVAL '1 hour',
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: CompleteChallenge :one
UPDATE challenges
SET status = 'COMPLETED', ended_at = NOW(), updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DisputeChallenge :one
UPDATE challenges
SET status = 'DISPUTED',
    disputed_by = $2,
    dispute_reason = $3,
    disputed_at = NOW(),
    updated_at = NOW()
WHERE id = $1
  AND status = 'VERDICT'
  AND dispute_deadline > NOW()
  AND (creator_id = $2 OR opponent_id = $2)
RETURNING *;

-- name: ResolveDispute :one
UPDATE challenges
SET status = $3,
    resolved_by = $2,
    resolution_note = $4,
    resolved_at = NOW(),
    updated_at = NOW()
WHERE id = $1 AND status = 'DISPUTED'
RETURNING *;

-- name: CancelChallenge :one
UPDATE challenges
SET status = 'CANCELLED', updated_at = NOW()
WHERE id = $1
  AND creator_id = $2
  AND status = 'OPEN'
RETURNING *;

-- name: AddRejectedBy :one
UPDATE challenges
SET rejected_by = array_append(COALESCE(rejected_by, '{}'), $2),
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: ReopenChallenge :one
UPDATE challenges
SET type = $2,
    opponent_id = NULL,
    status = 'OPEN',
    acceptance_deadline = NOW() + INTERVAL '24 hours',
    accepted_at = NULL,
    updated_at = NOW()
WHERE id = $1 AND creator_id = $3 AND status = 'OPEN'
RETURNING *;

-- name: ExpireChallenges :many
UPDATE challenges
SET status = 'EXPIRED', updated_at = NOW()
WHERE status = 'OPEN'
  AND acceptance_deadline < NOW()
RETURNING *;

-- name: AutoSubmitExpiredMatches :many
UPDATE challenges
SET status = 'AI_REVIEW', updated_at = NOW()
WHERE status = 'IN_PROGRESS'
  AND match_deadline < NOW()
RETURNING *;
