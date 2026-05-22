package notify

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/olamilekan-fazn/backend/internal/auth"
	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
)

type Handler struct {
	queries *sqlcgen.Queries
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{queries: sqlcgen.New(stdlib.OpenDBFromPool(pool))}
}

func userIDFromCtx(r *http.Request) (uuid.UUID, bool) {
	claims, ok := r.Context().Value(auth.ClaimsKey).(*auth.Claims)
	if !ok {
		return uuid.UUID{}, false
	}
	id, err := uuid.Parse(claims.UserID)
	if err != nil {
		return uuid.UUID{}, false
	}
	return id, true
}

func respondJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"status": "error", "message": message})
}

// POST /notifications/token
func (h *Handler) RegisterToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" {
		respondError(w, http.StatusBadRequest, "token is required")
		return
	}

	h.queries.RegisterPushToken(r.Context(), sqlcgen.RegisterPushTokenParams{
		UserID: userID,
		Token:  body.Token,
	})

	respondJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

// DELETE /notifications/token
func (h *Handler) DeleteToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Token == "" {
		respondError(w, http.StatusBadRequest, "token is required")
		return
	}

	h.queries.DeletePushToken(r.Context(), sqlcgen.DeletePushTokenParams{
		UserID: userID,
		Token:  body.Token,
	})

	respondJSON(w, http.StatusOK, map[string]string{"status": "success"})
}
