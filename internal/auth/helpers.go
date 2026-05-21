package auth

import (
	"encoding/json"
	"net/http"

	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
)

type safeUserResponse struct {
	ID        string `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"`
}

func safeUser(u sqlcgen.User) safeUserResponse {
	return safeUserResponse{
		ID:        u.ID.String(),
		FirstName: u.FirstName,
		LastName:  u.LastName,
		Username:  u.Username,
		Email:     u.Email,
		CreatedAt: u.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{
		"status":  "error",
		"message": message,
	})
}
