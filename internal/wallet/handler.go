package wallet

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/olamilekan-fazn/backend/internal/auth"
	"github.com/olamilekan-fazn/backend/internal/paystack"
	"github.com/olamilekan-fazn/backend/internal/sqlcgen"
	"github.com/sqlc-dev/pqtype"
)

const (
	minDepositKobo   = 100_000        // 1,000 NGN
	reviewThreshold  = 5_000_000      // 50,000 NGN — withdrawals above this go under review
	platformFeeRate  = 0.10
)

type Handler struct {
	queries   *sqlcgen.Queries
	pool      *pgxpool.Pool
	paystack  *paystack.Client
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{
		queries:  sqlcgen.New(stdlib.OpenDBFromPool(pool)),
		pool:     pool,
		paystack: paystack.New(),
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

// GET /wallet
func (h *Handler) GetWallet(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	wallet, err := h.queries.GetWalletByUserID(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusNotFound, "wallet not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"available_balance": wallet.AvailableBalance,
			"locked_balance":    wallet.LockedBalance,
			"total_balance":     wallet.AvailableBalance + wallet.LockedBalance,
		},
	})
}

// POST /wallet/deposit
func (h *Handler) InitiateDeposit(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		AmountKobo int64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.AmountKobo < minDepositKobo {
		respondError(w, http.StatusBadRequest, fmt.Sprintf("minimum deposit is %d kobo (1,000 NGN)", minDepositKobo))
		return
	}

	ctx := r.Context()
	user, err := h.queries.GetUserByID(ctx, userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	reference := fmt.Sprintf("dep_%s_%d", userID.String()[:8], time.Now().UnixMilli())

	paystackResp, err := h.paystack.InitializeTransaction(paystack.InitializeRequest{
		Email:       user.Email,
		AmountKobo:  body.AmountKobo,
		Reference:   reference,
		CallbackURL: "https://api.fazn.dev/wallet/deposit/callback",
	})
	if err != nil || !paystackResp.Status {
		respondError(w, http.StatusInternalServerError, "failed to initiate deposit")
		return
	}

	// Record pending transaction
	meta, _ := json.Marshal(map[string]string{"paystack_reference": reference})
	h.queries.CreateTransaction(ctx, sqlcgen.CreateTransactionParams{
		UserID:    userID,
		Type:      sqlcgen.TransactionTypeDEPOSIT,
		Amount:    body.AmountKobo,
		Status:    sqlcgen.TransactionStatusPENDING,
		Reference: reference,
		Metadata:  pqtype.NullRawMessage{RawMessage: meta, Valid: true},
	})

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"payment_url": paystackResp.Data.AuthorizationURL,
			"reference":   reference,
		},
	})
}

// GET /wallet/deposit/callback — Paystack redirects here after payment
// Verifies the transaction and redirects to app via deep link
func (h *Handler) DepositCallback(w http.ResponseWriter, r *http.Request) {
	reference := r.URL.Query().Get("reference")
	if reference == "" {
		reference = r.URL.Query().Get("trxref")
	}

	deepLink := "faznultra://wallet"

	if reference == "" {
		http.Redirect(w, r, deepLink+"?status=failed&reason=missing_reference", http.StatusTemporaryRedirect)
		return
	}

	verification, err := h.paystack.VerifyTransaction(reference)
	if err != nil || !verification.Status || verification.Data.Status != "success" {
		http.Redirect(w, r, deepLink+"?status=failed&reference="+reference, http.StatusTemporaryRedirect)
		return
	}

	// Wallet is credited via webhook — callback is only for routing user back to app
	http.Redirect(w, r, deepLink+"?status=success&reference="+reference, http.StatusTemporaryRedirect)
}

// POST /wallet/paystack/webhook
func (h *Handler) PaystackWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	signature := r.Header.Get("X-Paystack-Signature")
	if !paystack.ValidateWebhook(body, signature) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	var event struct {
		Event string `json:"event"`
		Data  struct {
			Reference string `json:"reference"`
			Status    string `json:"status"`
			Amount    int64  `json:"amount"`
			Customer  struct {
				Email string `json:"email"`
			} `json:"customer"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	switch event.Event {
	case "charge.success":
		tx, err := h.queries.GetTransactionByReference(ctx, event.Data.Reference)
		if err != nil || tx.Status == sqlcgen.TransactionStatusCOMPLETED {
			w.WriteHeader(http.StatusOK)
			return
		}

		h.queries.UpdateTransactionStatus(ctx, sqlcgen.UpdateTransactionStatusParams{
			ID:     tx.ID,
			Status: sqlcgen.TransactionStatusCOMPLETED,
		})
		h.queries.CreditAvailable(ctx, sqlcgen.CreditAvailableParams{
			UserID:  tx.UserID,
			AvailableBalance: tx.Amount,
		})

	case "transfer.success":
		tx, err := h.queries.GetTransactionByReference(ctx, event.Data.Reference)
		if err != nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		h.queries.UpdateTransactionStatus(ctx, sqlcgen.UpdateTransactionStatusParams{
			ID:     tx.ID,
			Status: sqlcgen.TransactionStatusCOMPLETED,
		})

	case "transfer.failed", "transfer.reversed":
		tx, err := h.queries.GetTransactionByReference(ctx, event.Data.Reference)
		if err != nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		// Refund the amount back to available balance
		h.queries.UpdateTransactionStatus(ctx, sqlcgen.UpdateTransactionStatusParams{
			ID:     tx.ID,
			Status: sqlcgen.TransactionStatusFAILED,
		})
		h.queries.CreditAvailable(ctx, sqlcgen.CreditAvailableParams{
			UserID:  tx.UserID,
			AvailableBalance: tx.Amount,
		})
	}

	w.WriteHeader(http.StatusOK)
}

// POST /wallet/bank-account
func (h *Handler) SaveBankAccount(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		BankCode      string `json:"bank_code"`
		AccountNumber string `json:"account_number"`
		BankName      string `json:"bank_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.BankCode == "" || body.AccountNumber == "" || body.BankName == "" {
		respondError(w, http.StatusBadRequest, "bank_code, account_number, and bank_name are required")
		return
	}

	// Verify account with Paystack
	resolved, err := h.paystack.ResolveAccount(body.AccountNumber, body.BankCode)
	if err != nil || !resolved.Status {
		respondError(w, http.StatusBadRequest, "could not verify bank account — check account number and bank code")
		return
	}

	// Create transfer recipient on Paystack
	recipient, err := h.paystack.CreateTransferRecipient(
		resolved.Data.AccountName,
		body.AccountNumber,
		body.BankCode,
	)
	if err != nil || !recipient.Status {
		respondError(w, http.StatusInternalServerError, "failed to register bank account")
		return
	}

	ctx := r.Context()
	account, err := h.queries.SaveBankAccount(ctx, sqlcgen.SaveBankAccountParams{
		UserID:                userID,
		BankName:              body.BankName,
		BankCode:              body.BankCode,
		AccountNumber:         body.AccountNumber,
		AccountName:           resolved.Data.AccountName,
		PaystackRecipientCode: recipient.Data.RecipientCode,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   safeBankAccount(account),
	})
}

// GET /wallet/bank-account
func (h *Handler) GetBankAccount(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	account, err := h.queries.GetBankAccount(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusNotFound, "no bank account saved")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data":   safeBankAccount(account),
	})
}

// POST /wallet/withdraw
func (h *Handler) Withdraw(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body struct {
		AmountKobo int64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.AmountKobo <= 0 {
		respondError(w, http.StatusBadRequest, "amount must be greater than 0")
		return
	}

	ctx := r.Context()

	// Must have a saved bank account
	account, err := h.queries.GetBankAccount(ctx, userID)
	if err != nil {
		respondError(w, http.StatusBadRequest, "you must save a bank account before withdrawing")
		return
	}

	// Deduct from available balance (fails atomically if insufficient)
	_, err = h.queries.DebitAvailable(ctx, sqlcgen.DebitAvailableParams{
		UserID:  userID,
		AvailableBalance: body.AmountKobo,
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "insufficient available balance")
		return
	}

	reference := fmt.Sprintf("wdw_%s_%d", userID.String()[:8], time.Now().UnixMilli())

	// Determine status — large withdrawals go under review
	status := sqlcgen.TransactionStatusPENDING
	if body.AmountKobo > reviewThreshold {
		status = sqlcgen.TransactionStatusUNDERREVIEW
	}

	meta, _ := json.Marshal(map[string]string{
		"bank_account": account.AccountNumber,
		"bank_name":    account.BankName,
		"account_name": account.AccountName,
	})
	tx, err := h.queries.CreateTransaction(ctx, sqlcgen.CreateTransactionParams{
		UserID:    userID,
		Type:      sqlcgen.TransactionTypeWITHDRAWAL,
		Amount:    body.AmountKobo,
		Status:    status,
		Reference: reference,
		Metadata:  pqtype.NullRawMessage{RawMessage: meta, Valid: true},
	})
	if err != nil {
		// Rollback the debit
		h.queries.CreditAvailable(ctx, sqlcgen.CreditAvailableParams{
			UserID:  userID,
			AvailableBalance: body.AmountKobo,
		})
		respondError(w, http.StatusInternalServerError, "server error")
		return
	}

	if status == sqlcgen.TransactionStatusUNDERREVIEW {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"status":  "success",
			"message": "withdrawal is under review and will be processed within 2 hours",
			"data":    safeTransaction(tx),
		})
		return
	}

	// Process immediately for amounts within threshold
	_, err = h.paystack.InitiateTransfer(body.AmountKobo, account.PaystackRecipientCode, reference, "FaznUltra withdrawal")
	if err != nil {
		// Refund on transfer failure
		h.queries.CreditAvailable(ctx, sqlcgen.CreditAvailableParams{
			UserID:  userID,
			AvailableBalance: body.AmountKobo,
		})
		h.queries.UpdateTransactionStatus(ctx, sqlcgen.UpdateTransactionStatusParams{
			ID:     tx.ID,
			Status: sqlcgen.TransactionStatusFAILED,
		})
		respondError(w, http.StatusInternalServerError, "transfer failed — please try again")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": "withdrawal initiated",
		"data":    safeTransaction(tx),
	})
}

// GET /wallet/transactions?type=DEPOSIT&from=2026-01-01&to=2026-12-31&page=1&limit=20
func (h *Handler) ListTransactions(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromCtx(r)
	if !ok {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	q := r.URL.Query()

	var txType sqlcgen.NullTransactionType
	if t := q.Get("type"); t != "" {
		txType = sqlcgen.NullTransactionType{
			TransactionType: sqlcgen.TransactionType(strings.ToUpper(t)),
			Valid:           true,
		}
	}

	var fromTime, toTime time.Time
	if f := q.Get("from"); f != "" {
		fromTime, _ = time.Parse("2006-01-02", f)
	}
	if t := q.Get("to"); t != "" {
		toTime, _ = time.Parse("2006-01-02", t)
		toTime = toTime.Add(24 * time.Hour) // inclusive
	}

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := int32((page - 1) * limit)

	ctx := r.Context()

	txs, err := h.queries.ListTransactions(ctx, sqlcgen.ListTransactionsParams{
		UserID:  userID,
		Column2: string(txType.TransactionType),
		Column3: fromTime,
		Column4: toTime,
		Limit:   int32(limit),
		Offset:  offset,
	})
	if err != nil {
		txs = []sqlcgen.Transaction{}
	}

	total, _ := h.queries.CountTransactions(ctx, sqlcgen.CountTransactionsParams{
		UserID:  userID,
		Column2: string(txType.TransactionType),
		Column3: fromTime,
		Column4: toTime,
	})

	result := make([]map[string]interface{}, len(txs))
	for i, tx := range txs {
		result[i] = safeTransaction(tx)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"transactions": result,
			"pagination": map[string]interface{}{
				"total": total,
				"page":  page,
				"limit": limit,
				"pages": (total + int64(limit) - 1) / int64(limit),
			},
		},
	})
}

func safeBankAccount(a sqlcgen.BankAccount) map[string]interface{} {
	return map[string]interface{}{
		"id":             a.ID,
		"bank_name":      a.BankName,
		"bank_code":      a.BankCode,
		"account_number": a.AccountNumber,
		"account_name":   a.AccountName,
	}
}

func safeTransaction(t sqlcgen.Transaction) map[string]interface{} {
	return map[string]interface{}{
		"id":         t.ID,
		"type":       t.Type,
		"amount":     t.Amount,
		"status":     t.Status,
		"reference":  t.Reference,
		"created_at": t.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"status": "error", "message": message})
}

// Unused import guard
var _ = sql.ErrNoRows
