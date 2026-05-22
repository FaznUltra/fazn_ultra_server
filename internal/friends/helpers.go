package friends

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/olamilekan-fazn/backend/internal/auth"
)

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"status": "error", "message": message})
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
