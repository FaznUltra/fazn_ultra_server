package profile

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/olamilekan-fazn/backend/internal/auth"
	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
	"github.com/google/uuid"
)

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

// GET /profile/me
func (h *Handler) GetMyProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	user, err := h.queries.GetUserByID(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   profileResponse(user),
	})
}

// PATCH /profile/me
func (h *Handler) UpdateMyProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		Bio            *string `json:"bio"`
		AvatarURL      *string `json:"avatar_url"`
		GamePreference *string `json:"game_preference"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Bio != nil && len(*body.Bio) > 160 {
		respondError(w, http.StatusBadRequest, "bio must be 160 characters or less")
		return
	}

	var gamePref sqlcgen.GamePreference
	if body.GamePreference != nil {
		pref := sqlcgen.GamePreference(strings.ToUpper(*body.GamePreference))
		if pref != sqlcgen.GamePreferenceEFOOTBALL && pref != sqlcgen.GamePreferenceDLS && pref != sqlcgen.GamePreferenceBOTH {
			respondError(w, http.StatusBadRequest, "game_preference must be EFOOTBALL, DLS, or BOTH")
			return
		}
		gamePref = pref
	}

	params := sqlcgen.UpdateProfileParams{ID: userID}

	if body.Bio != nil {
		params.Bio = sql.NullString{String: *body.Bio, Valid: true}
	}
	if body.AvatarURL != nil {
		params.AvatarUrl = sql.NullString{String: *body.AvatarURL, Valid: true}
	}
	if body.GamePreference != nil {
		params.GamePreference = gamePref
	}

	user, err := h.queries.UpdateProfile(r.Context(), params)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   profileResponse(user),
	})
}

// GET /profile/:username
func (h *Handler) GetPublicProfile(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	if username == "" {
		respondError(w, http.StatusBadRequest, "username is required")
		return
	}

	user, err := h.queries.GetUserByUsername(r.Context(), username)
	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   profileResponse(user),
	})
}

// POST /profile/avatar/upload-url
func (h *Handler) GetAvatarUploadURL(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	sig, err := GenerateUploadSignature(r.Context(), userID.String())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to generate upload URL")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   sig,
	})
}

func profileResponse(u sqlcgen.User) map[string]interface{} {
	resp := map[string]interface{}{
		"id":              u.ID,
		"first_name":      u.FirstName,
		"last_name":       u.LastName,
		"username":        u.Username,
		"email":           u.Email,
		"email_verified":  u.EmailVerified,
		"game_preference": u.GamePreference,
		"created_at":      u.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}
	if u.Bio.Valid {
		resp["bio"] = u.Bio.String
	}
	if u.AvatarUrl.Valid {
		resp["avatar_url"] = u.AvatarUrl.String
	}
	return resp
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"status": "error", "message": message})
}
