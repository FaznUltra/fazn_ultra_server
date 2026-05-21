package auth

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
	"golang.org/x/crypto/bcrypt"
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

// POST /auth/register
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Username  string `json:"username"`
		Email     string `json:"email"`
		Password  string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	body.Username = strings.ToLower(strings.TrimSpace(body.Username))

	if body.FirstName == "" || body.LastName == "" || body.Username == "" || body.Email == "" || body.Password == "" {
		respondError(w, http.StatusBadRequest, "all fields are required")
		return
	}

	if len(body.Password) < 8 {
		respondError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	ctx := r.Context()

	exists, err := h.queries.UsernameExists(ctx, body.Username)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}
	if exists {
		respondError(w, http.StatusConflict, "username already taken")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	user, err := h.queries.CreateUser(ctx, sqlcgen.CreateUserParams{
		FirstName:    body.FirstName,
		LastName:     body.LastName,
		Username:     body.Username,
		Email:        body.Email,
		PasswordHash: sql.NullString{String: string(hash), Valid: true},
		GoogleID:     sql.NullString{Valid: false},
	})
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			respondError(w, http.StatusConflict, "email already registered")
			return
		}
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	if err := h.sendOTP(ctx, user.ID, user.Email, user.FirstName); err != nil {
		respondError(w, http.StatusInternalServerError, "account created but failed to send verification email")
		return
	}

	token, err := GenerateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status":  "success",
		"message": "verification code sent to your email",
		"token":   token,
		"user":    safeUser(user),
	})
}

// POST /auth/verify-email
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	body.Email = strings.ToLower(strings.TrimSpace(body.Email))

	if body.Email == "" || body.Code == "" {
		respondError(w, http.StatusBadRequest, "email and code are required")
		return
	}

	ctx := r.Context()

	user, err := h.queries.VerifyEmailOTP(ctx, sqlcgen.VerifyEmailOTPParams{
		Email:   body.Email,
		OtpCode: sql.NullString{String: body.Code, Valid: true},
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid or expired code")
		return
	}

	token, err := GenerateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"token":  token,
		"user":   safeUser(user),
	})
}

// POST /auth/resend-otp
func (h *Handler) ResendOTP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	if body.Email == "" {
		respondError(w, http.StatusBadRequest, "email is required")
		return
	}

	ctx := r.Context()

	user, err := h.queries.GetUserByEmail(ctx, body.Email)
	if err != nil {
		// Don't reveal whether email exists
		respondJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "if that email exists, a code was sent"})
		return
	}

	if user.EmailVerified {
		respondError(w, http.StatusBadRequest, "email already verified")
		return
	}

	if err := h.sendOTP(ctx, user.ID, user.Email, user.FirstName); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to send verification email")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "verification code sent"})
}

// POST /auth/login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	body.Email = strings.ToLower(strings.TrimSpace(body.Email))

	if body.Email == "" || body.Password == "" {
		respondError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	ctx := r.Context()

	user, err := h.queries.GetUserByEmail(ctx, body.Email)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if !user.PasswordHash.Valid {
		respondError(w, http.StatusUnauthorized, "please sign in with Google")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(body.Password)); err != nil {
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if !user.EmailVerified {
		respondError(w, http.StatusForbidden, "email not verified — check your inbox for the verification code")
		return
	}

	token, err := GenerateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"token":  token,
		"user":   safeUser(user),
	})
}

// GET /auth/google
func (h *Handler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	url := googleOAuthConfig().AuthCodeURL("state")
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// GET /auth/google/callback
func (h *Handler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		respondError(w, http.StatusBadRequest, "missing code")
		return
	}

	ctx := r.Context()

	googleUser, err := fetchGoogleUser(ctx, code)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to fetch Google user")
		return
	}

	user, err := h.queries.GetUserByGoogleID(ctx, sql.NullString{String: googleUser.ID, Valid: true})
	if err != nil {
		// New Google user — create account, email pre-verified
		username, err := GenerateUniqueUsername(ctx, h.queries, googleUser.GivenName, googleUser.FamilyName)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "server error")
			return
		}

		user, err = h.queries.CreateUser(ctx, sqlcgen.CreateUserParams{
			FirstName:    googleUser.GivenName,
			LastName:     googleUser.FamilyName,
			Username:     username,
			Email:        strings.ToLower(googleUser.Email),
			PasswordHash: sql.NullString{Valid: false},
			GoogleID:     sql.NullString{String: googleUser.ID, Valid: true},
		})
		if err != nil {
			if strings.Contains(err.Error(), "unique") {
				respondError(w, http.StatusConflict, "email already registered with a different method")
				return
			}
			respondError(w, http.StatusInternalServerError, "server error")
			return
		}

		// Mark email verified immediately for Google users
		h.queries.SetEmailVerified(ctx, user.ID)
	}

	token, err := GenerateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"token":  token,
		"user":   safeUser(user),
	})
}
