package challenge

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
)

func internalSecret() string {
	return os.Getenv("INTERNAL_SECRET")
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"status": "error", "message": message})
}

func safeChallenge(c sqlcgen.Challenge) map[string]interface{} {
	m := map[string]interface{}{
		"id":                  c.ID,
		"creator_id":          c.CreatorID,
		"type":                c.Type,
		"game":                c.Game,
		"status":              c.Status,
		"stake_amount":        c.StakeAmount,
		"acceptance_deadline": c.AcceptanceDeadline,
		"creator_ready":       c.CreatorReady,
		"opponent_ready":      c.OpponentReady,
		"created_at":          c.CreatedAt,
		"updated_at":          c.UpdatedAt,
	}
	if c.OpponentID.Valid {
		m["opponent_id"] = c.OpponentID.UUID
	}
	if c.AcceptedAt.Valid {
		m["accepted_at"] = c.AcceptedAt.Time
	}
	if c.StartedAt.Valid {
		m["started_at"] = c.StartedAt.Time
	}
	if c.MatchDeadline.Valid {
		m["match_deadline"] = c.MatchDeadline.Time
	}
	if c.EndedAt.Valid {
		m["ended_at"] = c.EndedAt.Time
	}
	if c.CreatorStreamKey.Valid {
		m["creator_stream_key"] = c.CreatorStreamKey.String
	}
	if c.CreatorPlaybackID.Valid {
		m["creator_playback_id"] = c.CreatorPlaybackID.String
	}
	if c.OpponentPlaybackID.Valid {
		m["opponent_playback_id"] = c.OpponentPlaybackID.String
	}
	if c.AiWinnerID.Valid {
		m["ai_winner_id"] = c.AiWinnerID.UUID
	}
	if c.AiScore.Valid {
		m["ai_score"] = c.AiScore.String
	}
	if c.AiConfidence.Valid {
		m["ai_confidence"] = c.AiConfidence.String
	}
	if c.VerdictAt.Valid {
		m["verdict_at"] = c.VerdictAt.Time
	}
	if c.DisputeDeadline.Valid {
		m["dispute_deadline"] = c.DisputeDeadline.Time
	}
	if c.DisputedBy.Valid {
		m["disputed_by"] = c.DisputedBy.UUID
	}
	if c.DisputeReason.Valid {
		m["dispute_reason"] = c.DisputeReason.String
	}
	return m
}

