package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"math/big"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
	resend "github.com/resend/resend-go/v2"
)

func generateOTPCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

func (h *Handler) sendOTP(ctx context.Context, userID uuid.UUID, email, firstName string) error {
	code, err := generateOTPCode()
	if err != nil {
		return fmt.Errorf("failed to generate OTP: %w", err)
	}

	expiresAt := time.Now().Add(10 * time.Minute)

	if err := h.queries.SetOTP(ctx, sqlcgen.SetOTPParams{
		ID:           userID,
		OtpCode:      sql.NullString{String: code, Valid: true},
		OtpExpiresAt: sql.NullTime{Time: expiresAt, Valid: true},
	}); err != nil {
		return fmt.Errorf("failed to store OTP: %w", err)
	}

	return sendOTPEmail(email, firstName, code)
}

func sendOTPEmail(to, firstName, code string) error {
	apiKey := os.Getenv("RESEND_API_KEY")
	from := os.Getenv("RESEND_FROM")

	client := resend.NewClient(apiKey)

	html := fmt.Sprintf(`
<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
  <h2>Verify your FAZN account</h2>
  <p>Hi %s,</p>
  <p>Your verification code is:</p>
  <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;padding:24px;background:#f4f4f5;border-radius:8px;margin:24px 0">
    %s
  </div>
  <p>This code expires in <strong>10 minutes</strong>.</p>
  <p>If you didn't create a FAZN account, you can ignore this email.</p>
</div>`, firstName, code)

	_, err := client.Emails.Send(&resend.SendEmailRequest{
		From:    from,
		To:      []string{to},
		Subject: "Your FAZN verification code",
		Html:    html,
	})
	return err
}
