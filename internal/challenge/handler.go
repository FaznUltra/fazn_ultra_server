package challenge

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/olamilekan-fazn/backend/internal/auth"
	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
	"github.com/olamilekan-fazn/backend/internal/wallet"
	"github.com/sqlc-dev/pqtype"
)

const platformFeeRate = 0.10

type Handler struct {
	queries *sqlcgen.Queries
	pool    *pgxpool.Pool
	wallet  *wallet.Handler
}

func NewHandler(pool *pgxpool.Pool, w *wallet.Handler) *Handler {
	return &Handler{
		queries: sqlcgen.New(stdlib.OpenDBFromPool(pool)),
		pool:    pool,
		wallet:  w,
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

// POST /challenges
func (h *Handler) CreateChallenge(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		Game        string  `json:"game"`
		StakeAmount int64   `json:"stake_amount"`
		Type        string  `json:"type"`
		OpponentID  *string `json:"opponent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	game := sqlcgen.ChallengeGame(strings.ToUpper(body.Game))
	if game != sqlcgen.ChallengeGameEFOOTBALL && game != sqlcgen.ChallengeGameDLS {
		respondError(w, http.StatusBadRequest, "game must be EFOOTBALL or DLS")
		return
	}

	challengeType := sqlcgen.ChallengeType(strings.ToUpper(body.Type))
	if challengeType != sqlcgen.ChallengeTypePUBLIC &&
		challengeType != sqlcgen.ChallengeTypeFRIENDS &&
		challengeType != sqlcgen.ChallengeTypeDIRECT {
		respondError(w, http.StatusBadRequest, "type must be PUBLIC, FRIENDS, or DIRECT")
		return
	}

	if body.StakeAmount <= 0 {
		respondError(w, http.StatusBadRequest, "stake_amount must be greater than 0")
		return
	}

	ctx := r.Context()

	var opponentID uuid.NullUUID
	if challengeType == sqlcgen.ChallengeTypeDIRECT {
		if body.OpponentID == nil {
			respondError(w, http.StatusBadRequest, "opponent_id is required for DIRECT challenges")
			return
		}
		oid, err := uuid.Parse(*body.OpponentID)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid opponent_id")
			return
		}
		if oid == userID {
			respondError(w, http.StatusBadRequest, "you cannot challenge yourself")
			return
		}
		opponentID = uuid.NullUUID{UUID: oid, Valid: true}
	}

	walletQ := sqlcgen.New(stdlib.OpenDBFromPool(h.pool))
	_, err := walletQ.LockFunds(ctx, sqlcgen.LockFundsParams{
		UserID:           userID,
		AvailableBalance: body.StakeAmount,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "insufficient available balance")
		return
	}

	challenge, err := h.queries.CreateChallenge(ctx, sqlcgen.CreateChallengeParams{
		CreatorID:          userID,
		Type:               challengeType,
		Game:               game,
		StakeAmount:        body.StakeAmount,
		OpponentID:         opponentID,
		AcceptanceDeadline: time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		walletQ.UnlockFunds(ctx, sqlcgen.UnlockFundsParams{
			UserID:        userID,
			LockedBalance: body.StakeAmount,
		})
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	ref := fmt.Sprintf("stake_%s", challenge.ID.String()[:8])
	meta, _ := json.Marshal(map[string]string{"challenge_id": challenge.ID.String()})
	walletQ.CreateTransaction(ctx, sqlcgen.CreateTransactionParams{
		UserID:    userID,
		Type:      sqlcgen.TransactionTypeCHALLENGESTAKE,
		Amount:    body.StakeAmount,
		Status:    sqlcgen.TransactionStatusCOMPLETED,
		Reference: ref,
		Metadata:  pqtype.NullRawMessage{RawMessage: meta, Valid: true},
	})

	respondJSON(w, http.StatusCreated, map[string]interface{}{
		"status": "success",
		"data":   safeChallenge(challenge),
	})
}

// GET /challenges — open lobby
func (h *Handler) GetLobby(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	q := r.URL.Query()
	var game sqlcgen.NullChallengeGame
	if g := q.Get("game"); g != "" {
		game = sqlcgen.NullChallengeGame{
			ChallengeGame: sqlcgen.ChallengeGame(strings.ToUpper(g)),
			Valid:          true,
		}
	}

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit := int32(20)
	offset := int32((page - 1) * 20)

	ctx := r.Context()

	// Friends system not yet built — include only the user's own ID so FRIENDS challenges are visible
	friendIDs := []uuid.UUID{userID}

	challenges, err := h.queries.GetOpenLobby(ctx, sqlcgen.GetOpenLobbyParams{
		Column1: friendIDs,
		Column2: game.ChallengeGame,
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		challenges = []sqlcgen.Challenge{}
	}

	result := make([]map[string]interface{}, len(challenges))
	for i, c := range challenges {
		result[i] = safeChallenge(c)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   result,
	})
}

// GET /challenges/my
func (h *Handler) GetMyChallenges(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit := int32(20)
	offset := int32((page - 1) * 20)

	challenges, err := h.queries.GetMyChallenges(r.Context(), sqlcgen.GetMyChallengesParams{
		CreatorID: userID,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		challenges = []sqlcgen.Challenge{}
	}

	result := make([]map[string]interface{}, len(challenges))
	for i, c := range challenges {
		result[i] = safeChallenge(c)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   result,
	})
}

// GET /challenges/:id
func (h *Handler) GetChallenge(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid challenge id")
		return
	}

	challenge, err := h.queries.GetChallengeByID(r.Context(), id)
	if err != nil {
		respondError(w, http.StatusNotFound, "challenge not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   safeChallenge(challenge),
	})
}

// POST /challenges/:id/accept
func (h *Handler) AcceptChallenge(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid challenge id")
		return
	}

	ctx := r.Context()

	existing, err := h.queries.GetChallengeByID(ctx, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "challenge not found")
		return
	}

	if existing.Type == sqlcgen.ChallengeTypeDIRECT {
		if !existing.OpponentID.Valid || existing.OpponentID.UUID != userID {
			respondError(w, http.StatusForbidden, "this challenge is not addressed to you")
			return
		}
	}

	walletQ := sqlcgen.New(stdlib.OpenDBFromPool(h.pool))
	_, err = walletQ.LockFunds(ctx, sqlcgen.LockFundsParams{
		UserID:           userID,
		AvailableBalance: existing.StakeAmount,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "insufficient available balance to match the stake")
		return
	}

	opponentNullUUID := uuid.NullUUID{UUID: userID, Valid: true}
	challenge, err := h.queries.AcceptChallenge(ctx, sqlcgen.AcceptChallengeParams{
		ID:         id,
		OpponentID: opponentNullUUID,
	})
	if err != nil {
		walletQ.UnlockFunds(ctx, sqlcgen.UnlockFundsParams{
			UserID:        userID,
			LockedBalance: existing.StakeAmount,
		})
		respondError(w, http.StatusConflict, "challenge is no longer available")
		return
	}

	ref := fmt.Sprintf("stake_%s_opp", challenge.ID.String()[:8])
	meta, _ := json.Marshal(map[string]string{"challenge_id": challenge.ID.String()})
	walletQ.CreateTransaction(ctx, sqlcgen.CreateTransactionParams{
		UserID:    userID,
		Type:      sqlcgen.TransactionTypeCHALLENGESTAKE,
		Amount:    existing.StakeAmount,
		Status:    sqlcgen.TransactionStatusCOMPLETED,
		Reference: ref,
		Metadata:  pqtype.NullRawMessage{RawMessage: meta, Valid: true},
	})

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "challenge accepted — confirm ready when you're in the game",
		"data":    safeChallenge(challenge),
	})
}

// POST /challenges/:id/reject
func (h *Handler) RejectChallenge(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid challenge id")
		return
	}

	ctx := r.Context()

	existing, err := h.queries.GetChallengeByID(ctx, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "challenge not found")
		return
	}

	if existing.Type != sqlcgen.ChallengeTypeDIRECT || !existing.OpponentID.Valid || existing.OpponentID.UUID != userID {
		respondError(w, http.StatusForbidden, "you cannot reject this challenge")
		return
	}

	_, err = h.queries.AddRejectedBy(ctx, sqlcgen.AddRejectedByParams{
		ID:          id,
		ArrayAppend: userID,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	h.queries.ReopenChallenge(ctx, sqlcgen.ReopenChallengeParams{
		ID:        id,
		Type:      existing.Type,
		CreatorID: existing.CreatorID,
	})

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "challenge rejected",
	})
}

// POST /challenges/:id/ready
func (h *Handler) ConfirmReady(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid challenge id")
		return
	}

	ctx := r.Context()

	existing, err := h.queries.GetChallengeByID(ctx, id)
	if err != nil {
		respondError(w, http.StatusNotFound, "challenge not found")
		return
	}

	if existing.Status != sqlcgen.ChallengeStatusACCEPTED {
		respondError(w, http.StatusBadRequest, "challenge is not in ACCEPTED state")
		return
	}

	var challenge sqlcgen.Challenge
	if existing.CreatorID == userID {
		challenge, err = h.queries.SetCreatorReady(ctx, sqlcgen.SetCreatorReadyParams{
			ID: id, CreatorID: userID,
		})
	} else if existing.OpponentID.Valid && existing.OpponentID.UUID == userID {
		challenge, err = h.queries.SetOpponentReady(ctx, sqlcgen.SetOpponentReadyParams{
			ID: id, OpponentID: uuid.NullUUID{UUID: userID, Valid: true},
		})
	} else {
		respondError(w, http.StatusForbidden, "you are not a participant in this challenge")
		return
	}

	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	// If both ready, create Mux streams and start the match
	if challenge.CreatorReady && challenge.OpponentReady {
		streams, err := CreateMuxLiveStreams(ctx, challenge.ID.String())
		if err == nil {
			h.queries.SetMuxStreams(ctx, sqlcgen.SetMuxStreamsParams{
				ID:                 challenge.ID,
				CreatorStreamKey:   sql.NullString{String: streams.CreatorStreamKey, Valid: true},
				CreatorPlaybackID:  sql.NullString{String: streams.CreatorPlaybackID, Valid: true},
				OpponentStreamKey:  sql.NullString{String: streams.OpponentStreamKey, Valid: true},
				OpponentPlaybackID: sql.NullString{String: streams.OpponentPlaybackID, Valid: true},
			})
		}

		challenge, _ = h.queries.StartChallenge(ctx, id)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   safeChallenge(challenge),
	})
}

// POST /challenges/:id/cancel
func (h *Handler) CancelChallenge(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid challenge id")
		return
	}

	ctx := r.Context()

	challenge, err := h.queries.CancelChallenge(ctx, sqlcgen.CancelChallengeParams{
		ID: id, CreatorID: userID,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "cannot cancel this challenge — it may already be accepted")
		return
	}

	walletQ := sqlcgen.New(stdlib.OpenDBFromPool(h.pool))
	walletQ.UnlockFunds(ctx, sqlcgen.UnlockFundsParams{
		UserID:        userID,
		LockedBalance: challenge.StakeAmount,
	})

	ref := fmt.Sprintf("refund_%s", challenge.ID.String()[:8])
	meta, _ := json.Marshal(map[string]string{"challenge_id": challenge.ID.String()})
	walletQ.CreateTransaction(ctx, sqlcgen.CreateTransactionParams{
		UserID:    userID,
		Type:      sqlcgen.TransactionTypeCHALLENGEREFUND,
		Amount:    challenge.StakeAmount,
		Status:    sqlcgen.TransactionStatusCOMPLETED,
		Reference: ref,
		Metadata:  pqtype.NullRawMessage{RawMessage: meta, Valid: true},
	})

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "challenge cancelled and stake refunded",
	})
}

// POST /challenges/:id/dispute
func (h *Handler) DisputeChallenge(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid challenge id")
		return
	}

	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Reason == "" {
		respondError(w, http.StatusBadRequest, "reason is required")
		return
	}

	challenge, err := h.queries.DisputeChallenge(r.Context(), sqlcgen.DisputeChallengeParams{
		ID:            id,
		DisputedBy:    uuid.NullUUID{UUID: userID, Valid: true},
		DisputeReason: sql.NullString{String: body.Reason, Valid: true},
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "dispute window has closed or challenge is not in VERDICT state")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "dispute raised — funds frozen pending admin review",
		"data":    safeChallenge(challenge),
	})
}

// POST /challenges/:id/verdict  (internal — called by AI service)
func (h *Handler) SubmitVerdict(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Internal-Secret") != internalSecret() {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid challenge id")
		return
	}

	var body struct {
		WinnerID   string  `json:"winner_id"`
		Score      string  `json:"score"`
		Confidence float64 `json:"confidence"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	winnerID, err := uuid.Parse(body.WinnerID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid winner_id")
		return
	}

	ctx := r.Context()

	challenge, err := h.queries.SubmitVerdict(ctx, sqlcgen.SubmitVerdictParams{
		ID:           id,
		AiWinnerID:   uuid.NullUUID{UUID: winnerID, Valid: true},
		AiScore:      sql.NullString{String: body.Score, Valid: true},
		AiConfidence: sql.NullString{String: fmt.Sprintf("%.2f", body.Confidence), Valid: true},
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	// Low confidence → escalate to admin instead of auto-paying
	if body.Confidence < 0.80 {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"status":  "success",
			"message": "low confidence — escalated to admin",
		})
		return
	}

	// Payout after 1hr dispute window
	go func() {
		time.Sleep(1 * time.Hour)
		h.processPayout(challenge)
	}()

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   safeChallenge(challenge),
	})
}

func (h *Handler) processPayout(challenge sqlcgen.Challenge) {
	if !challenge.AiWinnerID.Valid {
		return
	}

	ctx := context.Background()

	latest, err := h.queries.GetChallengeByID(ctx, challenge.ID)
	if err != nil || latest.Status != sqlcgen.ChallengeStatusVERDICT {
		return
	}

	walletQ := sqlcgen.New(stdlib.OpenDBFromPool(h.pool))
	winnerID := latest.AiWinnerID.UUID
	loserID := latest.CreatorID
	if winnerID == latest.CreatorID {
		loserID = latest.OpponentID.UUID
	}

	stake := latest.StakeAmount
	winnings := int64(float64(stake*2) * (1 - platformFeeRate))
	fee := stake*2 - winnings

	walletQ.DeductLocked(ctx, sqlcgen.DeductLockedParams{
		UserID: latest.CreatorID, LockedBalance: stake,
	})
	walletQ.DeductLocked(ctx, sqlcgen.DeductLockedParams{
		UserID: latest.OpponentID.UUID, LockedBalance: stake,
	})

	walletQ.CreditAvailable(ctx, sqlcgen.CreditAvailableParams{
		UserID: winnerID, AvailableBalance: winnings,
	})

	ref := fmt.Sprintf("win_%s", latest.ID.String()[:8])
	meta, _ := json.Marshal(map[string]interface{}{
		"challenge_id": latest.ID.String(),
		"score":        latest.AiScore.String,
		"fee":          fee,
	})
	walletQ.CreateTransaction(ctx, sqlcgen.CreateTransactionParams{
		UserID:    winnerID,
		Type:      sqlcgen.TransactionTypeCHALLENGEWINNINGS,
		Amount:    winnings,
		Status:    sqlcgen.TransactionStatusCOMPLETED,
		Reference: ref,
		Metadata:  pqtype.NullRawMessage{RawMessage: meta, Valid: true},
	})

	feeRef := fmt.Sprintf("fee_%s", latest.ID.String()[:8])
	walletQ.CreateTransaction(ctx, sqlcgen.CreateTransactionParams{
		UserID:    loserID,
		Type:      sqlcgen.TransactionTypePLATFORMFEE,
		Amount:    fee,
		Status:    sqlcgen.TransactionStatusCOMPLETED,
		Reference: feeRef,
		Metadata:  pqtype.NullRawMessage{RawMessage: meta, Valid: true},
	})

	h.queries.CompleteChallenge(ctx, latest.ID)
}
