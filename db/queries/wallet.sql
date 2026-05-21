-- name: CreateWallet :one
INSERT INTO wallets (user_id) VALUES ($1) RETURNING *;

-- name: GetWalletByUserID :one
SELECT * FROM wallets WHERE user_id = $1 LIMIT 1;

-- name: CreditAvailable :one
UPDATE wallets
SET available_balance = available_balance + $2, updated_at = NOW()
WHERE user_id = $1
RETURNING *;

-- name: DebitAvailable :one
UPDATE wallets
SET available_balance = available_balance - $2, updated_at = NOW()
WHERE user_id = $1 AND available_balance >= $2
RETURNING *;

-- name: LockFunds :one
UPDATE wallets
SET available_balance = available_balance - $2,
    locked_balance = locked_balance + $2,
    updated_at = NOW()
WHERE user_id = $1 AND available_balance >= $2
RETURNING *;

-- name: UnlockFunds :one
UPDATE wallets
SET locked_balance = locked_balance - $2,
    available_balance = available_balance + $2,
    updated_at = NOW()
WHERE user_id = $1 AND locked_balance >= $2
RETURNING *;

-- name: DeductLocked :one
UPDATE wallets
SET locked_balance = locked_balance - $2, updated_at = NOW()
WHERE user_id = $1 AND locked_balance >= $2
RETURNING *;

-- name: CreateTransaction :one
INSERT INTO transactions (user_id, type, amount, status, reference, metadata)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetTransactionByReference :one
SELECT * FROM transactions WHERE reference = $1 LIMIT 1;

-- name: UpdateTransactionStatus :one
UPDATE transactions SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *;

-- name: ListTransactions :many
SELECT * FROM transactions
WHERE user_id = $1
  AND (CAST($2 AS TEXT) = '' OR type = $2::transaction_type)
  AND ($3::timestamptz = '0001-01-01' OR created_at >= $3)
  AND ($4::timestamptz = '0001-01-01' OR created_at <= $4)
ORDER BY created_at DESC
LIMIT $5 OFFSET $6;

-- name: CountTransactions :one
SELECT COUNT(*) FROM transactions
WHERE user_id = $1
  AND (CAST($2 AS TEXT) = '' OR type = $2::transaction_type)
  AND ($3::timestamptz = '0001-01-01' OR created_at >= $3)
  AND ($4::timestamptz = '0001-01-01' OR created_at <= $4);

-- name: SaveBankAccount :one
INSERT INTO bank_accounts (user_id, bank_name, bank_code, account_number, account_name, paystack_recipient_code)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (user_id) DO UPDATE
SET bank_name = EXCLUDED.bank_name,
    bank_code = EXCLUDED.bank_code,
    account_number = EXCLUDED.account_number,
    account_name = EXCLUDED.account_name,
    paystack_recipient_code = EXCLUDED.paystack_recipient_code
RETURNING *;

-- name: GetBankAccount :one
SELECT * FROM bank_accounts WHERE user_id = $1 LIMIT 1;
