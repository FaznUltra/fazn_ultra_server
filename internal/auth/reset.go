package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
	"golang.org/x/crypto/bcrypt"
)

// POST /auth/forgot-password
func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
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
		respondJSON(w, http.StatusOK, map[string]string{
			"status":  "success",
			"message": "if that email is registered, a reset code has been sent",
		})
		return
	}

	if !user.PasswordHash.Valid {
		respondError(w, http.StatusBadRequest, "this account uses Google sign-in — password reset is not available")
		return
	}

	if err := h.sendOTP(ctx, user.ID, user.Email, user.FirstName); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to send reset code")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": "reset code sent to your email",
	})
}

// POST /auth/verify-reset-otp
func (h *Handler) VerifyResetOTP(w http.ResponseWriter, r *http.Request) {
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

	// Generate a secure one-time reset token valid for 15 minutes
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}
	resetToken := hex.EncodeToString(tokenBytes)
	expiresAt := time.Now().Add(15 * time.Minute)

	_, err := h.queries.VerifyResetOTP(ctx, sqlcgen.VerifyResetOTPParams{
		Email:               body.Email,
		OtpCode:             sql.NullString{String: body.Code, Valid: true},
		ResetToken:          sql.NullString{String: resetToken, Valid: true},
		ResetTokenExpiresAt: sql.NullTime{Time: expiresAt, Valid: true},
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid or expired code")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "success",
		"reset_token": resetToken,
		"message":     "OTP verified — use the reset_token to set a new password",
	})
}

// POST /auth/reset-password
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ResetToken  string `json:"reset_token"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.ResetToken == "" || body.NewPassword == "" {
		respondError(w, http.StatusBadRequest, "reset_token and new_password are required")
		return
	}

	if len(body.NewPassword) < 8 {
		respondError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	ctx := r.Context()

	user, err := h.queries.ResetPassword(ctx, sqlcgen.ResetPasswordParams{
		ResetToken:   sql.NullString{String: body.ResetToken, Valid: true},
		PasswordHash: sql.NullString{String: string(hash), Valid: true},
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid or expired reset token")
		return
	}

	token, err := GenerateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "password reset successful",
		"token":   token,
		"user":    safeUser(user),
	})
}

// sendPasswordResetEmail uses the same OTP email but with reset-specific copy
func sendPasswordResetEmail(to, firstName, code string) error {
	return sendOTPEmail(to, firstName, fmt.Sprintf("%s (password reset)", code))
}
