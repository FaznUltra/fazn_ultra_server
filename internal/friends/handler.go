package friends

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
)

const onlineWindow = 2 * time.Minute

type Handler struct {
	queries *sqlcgen.Queries
	pool    *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{
		queries: sqlcgen.New(stdlib.OpenDBFromPool(pool)),
		pool:    pool,
	}
}

func parseTargetUserID(r *http.Request) (uuid.UUID, error) {
	return uuid.Parse(r.PathValue("user_id"))
}

// POST /friends/request/{user_id}
func (h *Handler) SendRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	targetID, err := parseTargetUserID(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid user_id")
		return
	}
	if targetID == userID {
		respondError(w, http.StatusBadRequest, "you cannot friend yourself")
		return
	}

	ctx := r.Context()

	existing, err := h.queries.GetFriendshipBetween(ctx, sqlcgen.GetFriendshipBetweenParams{
		RequesterID: userID,
		AddresseeID: targetID,
	})
	if err == nil {
		switch existing.Status {
		case sqlcgen.FriendshipStatusACCEPTED:
			respondError(w, http.StatusConflict, "already friends")
			return
		case sqlcgen.FriendshipStatusPENDING:
			// If the OTHER user sent it, auto-accept.
			if existing.RequesterID == targetID {
				accepted, err := h.queries.AcceptFriendRequest(ctx, sqlcgen.AcceptFriendRequestParams{
					RequesterID: targetID,
					AddresseeID: userID,
				})
				if err != nil {
					respondError(w, http.StatusInternalServerError, "server error")
					return
				}
				respondJSON(w, http.StatusOK, map[string]interface{}{
					"status":  "success",
					"message": "friend request auto-accepted",
					"data":    accepted,
				})
				return
			}
			// Same direction — already pending.
			respondError(w, http.StatusConflict, "friend request already pending")
			return
		case sqlcgen.FriendshipStatusDECLINED:
			respondError(w, http.StatusConflict, "request was previously declined")
			return
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	friendship, err := h.queries.SendFriendRequest(ctx, sqlcgen.SendFriendRequestParams{
		RequesterID: userID,
		AddresseeID: targetID,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "success",
		"data":   friendship,
	})
}

// POST /friends/accept/{user_id}
func (h *Handler) AcceptRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	targetID, err := parseTargetUserID(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid user_id")
		return
	}

	friendship, err := h.queries.AcceptFriendRequest(r.Context(), sqlcgen.AcceptFriendRequestParams{
		RequesterID: targetID,
		AddresseeID: userID,
	})
	if err != nil {
		respondError(w, http.StatusNotFound, "no pending friend request from this user")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   friendship,
	})
}

// POST /friends/decline/{user_id}
func (h *Handler) DeclineRequest(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	targetID, err := parseTargetUserID(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid user_id")
		return
	}

	friendship, err := h.queries.DeclineFriendRequest(r.Context(), sqlcgen.DeclineFriendRequestParams{
		RequesterID: targetID,
		AddresseeID: userID,
	})
	if err != nil {
		respondError(w, http.StatusNotFound, "no pending friend request from this user")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   friendship,
	})
}

// DELETE /friends/{user_id}
func (h *Handler) RemoveFriend(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	targetID, err := parseTargetUserID(r)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid user_id")
		return
	}

	if err := h.queries.RemoveFriend(r.Context(), sqlcgen.RemoveFriendParams{
		RequesterID: userID,
		AddresseeID: targetID,
	}); err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "friend removed",
	})
}

// GET /friends
func (h *Handler) GetFriends(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	ctx := r.Context()

	friends, err := h.queries.GetFriends(ctx, userID)
	if err != nil {
		friends = []sqlcgen.GetFriendsRow{}
	}

	result := make([]map[string]interface{}, 0, len(friends))
	now := time.Now()

	for _, f := range friends {
		entry := map[string]interface{}{
			"id":              f.ID,
			"username":        f.Username,
			"first_name":      f.FirstName,
			"last_name":       f.LastName,
			"avatar_url":      nil,
			"game_preference": f.GamePreference,
			"status":          "offline",
		}
		if f.AvatarUrl.Valid {
			entry["avatar_url"] = f.AvatarUrl.String
		}

		active, err := h.queries.GetActiveChallenge(ctx, f.ID)
		if err == nil {
			entry["status"] = "in_game"
			entry["game"] = active.Game
			if active.CreatorID == f.ID {
				if active.CreatorPlaybackID.Valid {
					entry["playback_id"] = active.CreatorPlaybackID.String
				}
			} else {
				if active.OpponentPlaybackID.Valid {
					entry["playback_id"] = active.OpponentPlaybackID.String
				}
			}
		} else if f.LastSeenAt.Valid && now.Sub(f.LastSeenAt.Time) <= onlineWindow {
			entry["status"] = "online"
		}

		result = append(result, entry)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   result,
	})
}

// GET /friends/requests
func (h *Handler) GetPendingRequests(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	rows, err := h.queries.GetPendingRequests(r.Context(), userID)
	if err != nil {
		rows = []sqlcgen.GetPendingRequestsRow{}
	}

	result := make([]map[string]interface{}, 0, len(rows))
	for _, p := range rows {
		entry := map[string]interface{}{
			"id":              p.ID,
			"username":        p.Username,
			"first_name":      p.FirstName,
			"last_name":       p.LastName,
			"avatar_url":      nil,
			"game_preference": p.GamePreference,
			"requested_at":    p.RequestedAt,
		}
		if p.AvatarUrl.Valid {
			entry["avatar_url"] = p.AvatarUrl.String
		}
		result = append(result, entry)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   result,
	})
}
