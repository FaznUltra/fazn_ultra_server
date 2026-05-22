package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/olamilekan-fazn/backend/internal/auth"
	"github.com/olamilekan-fazn/backend/internal/challenge"
	"github.com/olamilekan-fazn/backend/internal/db"
	"github.com/olamilekan-fazn/backend/internal/friends"
	"github.com/olamilekan-fazn/backend/internal/notify"
	"github.com/olamilekan-fazn/backend/internal/profile"
	"github.com/olamilekan-fazn/backend/internal/wallet"
)

type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Message string `json:"message"`
}

func healthHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(HealthResponse{
			Status:  "success",
			Version: "001",
			Message: "server is healthy",
		})
	}
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, reading from environment")
	}

	ctx := context.Background()

	if err := db.RunMigrations(); err != nil {
		log.Fatalf("migrations failed: %v", err)
	}
	log.Println("migrations applied")

	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer pool.Close()
	log.Println("database connected")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	authHandler := auth.NewHandler(pool)
	walletHandler := wallet.NewHandler(pool)
	profileHandler := profile.NewHandler(pool)
	challengeHandler := challenge.NewHandler(pool, walletHandler)
	friendsHandler := friends.NewHandler(pool)
	notifyHandler := notify.NewHandler(pool)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler(pool))

	// Auth routes (public)
	mux.HandleFunc("POST /auth/register", authHandler.Register)
	mux.HandleFunc("POST /auth/login", authHandler.Login)
	mux.HandleFunc("POST /auth/verify-email", authHandler.VerifyEmail)
	mux.HandleFunc("POST /auth/resend-otp", authHandler.ResendOTP)
	mux.HandleFunc("GET /auth/google", authHandler.GoogleLogin)
	mux.HandleFunc("GET /auth/google/callback", authHandler.GoogleCallback)
	mux.HandleFunc("POST /auth/forgot-password", authHandler.ForgotPassword)
	mux.HandleFunc("POST /auth/verify-reset-otp", authHandler.VerifyResetOTP)
	mux.HandleFunc("POST /auth/reset-password", authHandler.ResetPassword)

	// Wallet routes (protected)
	mux.HandleFunc("GET /wallet", auth.RequireAuth(walletHandler.GetWallet))
	mux.HandleFunc("POST /wallet/deposit", auth.RequireAuth(walletHandler.InitiateDeposit))
	mux.HandleFunc("POST /wallet/withdraw", auth.RequireAuth(walletHandler.Withdraw))
	mux.HandleFunc("GET /wallet/transactions", auth.RequireAuth(walletHandler.ListTransactions))
	mux.HandleFunc("POST /wallet/bank-account", auth.RequireAuth(walletHandler.SaveBankAccount))
	mux.HandleFunc("GET /wallet/bank-account", auth.RequireAuth(walletHandler.GetBankAccount))

	// Profile routes (protected)
	mux.HandleFunc("GET /profile/me", auth.RequireAuth(profileHandler.GetMyProfile))
	mux.HandleFunc("PATCH /profile/me", auth.RequireAuth(profileHandler.UpdateMyProfile))
	mux.HandleFunc("POST /profile/avatar/upload-url", auth.RequireAuth(profileHandler.GetAvatarUploadURL))
	mux.HandleFunc("GET /profile/{username}", profileHandler.GetPublicProfile)

	// Challenge routes (protected)
	mux.HandleFunc("POST /challenges", auth.RequireAuth(challengeHandler.CreateChallenge))
	mux.HandleFunc("GET /challenges", auth.RequireAuth(challengeHandler.GetLobby))
	mux.HandleFunc("GET /challenges/my", auth.RequireAuth(challengeHandler.GetMyChallenges))
	mux.HandleFunc("GET /challenges/{id}", auth.RequireAuth(challengeHandler.GetChallenge))
	mux.HandleFunc("POST /challenges/{id}/accept", auth.RequireAuth(challengeHandler.AcceptChallenge))
	mux.HandleFunc("POST /challenges/{id}/reject", auth.RequireAuth(challengeHandler.RejectChallenge))
	mux.HandleFunc("POST /challenges/{id}/ready", auth.RequireAuth(challengeHandler.ConfirmReady))
	mux.HandleFunc("POST /challenges/{id}/cancel", auth.RequireAuth(challengeHandler.CancelChallenge))
	mux.HandleFunc("POST /challenges/{id}/dispute", auth.RequireAuth(challengeHandler.DisputeChallenge))
	mux.HandleFunc("POST /challenges/{id}/verdict", challengeHandler.SubmitVerdict) // internal only, guarded by X-Internal-Secret

	// Friends routes (protected)
	mux.HandleFunc("POST /friends/request/{user_id}", auth.RequireAuth(friendsHandler.SendRequest))
	mux.HandleFunc("POST /friends/accept/{user_id}", auth.RequireAuth(friendsHandler.AcceptRequest))
	mux.HandleFunc("POST /friends/decline/{user_id}", auth.RequireAuth(friendsHandler.DeclineRequest))
	mux.HandleFunc("DELETE /friends/{user_id}", auth.RequireAuth(friendsHandler.RemoveFriend))
	mux.HandleFunc("GET /friends", auth.RequireAuth(friendsHandler.GetFriends))
	mux.HandleFunc("GET /friends/requests", auth.RequireAuth(friendsHandler.GetPendingRequests))

	// Presence (protected)
	mux.HandleFunc("POST /presence/ping", auth.RequireAuth(friendsHandler.Ping))

	// Notification token routes (protected)
	mux.HandleFunc("POST /notifications/token", auth.RequireAuth(notifyHandler.RegisterToken))
	mux.HandleFunc("DELETE /notifications/token", auth.RequireAuth(notifyHandler.DeleteToken))

	// Paystack public routes (no auth — verified by signature or reference)
	mux.HandleFunc("GET /wallet/deposit/callback", walletHandler.DepositCallback)
	mux.HandleFunc("POST /wallet/paystack/webhook", walletHandler.PaystackWebhook)

	log.Printf("server starting on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
