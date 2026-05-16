import { randomUUID } from 'crypto';
import { pool } from '../db/client';
import { TransactionRow } from '../types/wallet';
import * as paystack from './paystack.service';
import { env } from '../config/env';

const KOBO_PER_NAIRA = 100;
const WITHDRAWAL_FEE_NAIRA = 100;
const MIN_WITHDRAWAL_NAIRA = 500;
const RECENT_TX_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;

interface DomainError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

function domainError(status: number, code: string, message: string): DomainError {
  return Object.assign(new Error(message), { status, code }) as DomainError;
}

function nairaToKobo(naira: number): number {
  return Math.round(naira * KOBO_PER_NAIRA);
}

function koboToNaira(kobo: number): number {
  return kobo / KOBO_PER_NAIRA;
}

// API-facing transaction shape (mobile contract: amount in Naira, camelCase).
export interface TransactionDTO {
  id: string;
  type: string;
  status: string;
  amount: number;
  description: string;
  reference: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

function toDTO(row: TransactionRow): TransactionDTO {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount: Number(row.amount),
    description: row.description,
    reference: row.reference,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

function makeReference(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

// ─── Get wallet summary ───────────────────────────────────────────────────────

export interface WalletSummary {
  balance: number;
  pendingAmount: number;
  totalWon: number;
  totalSpent: number;
  transactions: TransactionDTO[];
}

export async function getWallet(userId: string): Promise<WalletSummary> {
  const walletRes = await pool.query<{ balance: string }>(
    'SELECT balance FROM wallets WHERE user_id = $1',
    [userId],
  );

  if (walletRes.rowCount === 0) {
    // Defensive: trigger should always create one, but never crash if missing.
    await pool.query(
      'INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [userId],
    );
  }

  const balance = walletRes.rows[0] ? Number(walletRes.rows[0].balance) : 0;

  const aggRes = await pool.query<{
    pending_amount: string | null;
    total_won: string | null;
    total_spent: string | null;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE type = 'top_up' AND status = 'pending'), 0)            AS pending_amount,
       COALESCE(SUM(amount) FILTER (WHERE type = 'challenge_win' AND status = 'completed'), 0)   AS total_won,
       COALESCE(SUM(amount) FILTER (WHERE type = 'challenge_entry' AND status = 'completed'), 0) AS total_spent
     FROM transactions
     WHERE user_id = $1`,
    [userId],
  );

  const agg = aggRes.rows[0];

  const txRes = await pool.query<TransactionRow>(
    `SELECT id, user_id, type, status, amount, description, reference, metadata, created_at, updated_at
     FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, RECENT_TX_LIMIT],
  );

  return {
    balance,
    pendingAmount: Number(agg.pending_amount ?? 0),
    totalWon: Number(agg.total_won ?? 0),
    totalSpent: Number(agg.total_spent ?? 0),
    transactions: txRes.rows.map(toDTO),
  };
}

// ─── Paginated transactions ───────────────────────────────────────────────────

export async function getTransactions(
  userId: string,
  page: number,
  limit: number,
): Promise<{ transactions: TransactionDTO[]; total: number; page: number; limit: number }> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), MAX_PAGE_LIMIT) : 20;
  const offset = (safePage - 1) * safeLimit;

  const countRes = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM transactions WHERE user_id = $1',
    [userId],
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  const txRes = await pool.query<TransactionRow>(
    `SELECT id, user_id, type, status, amount, description, reference, metadata, created_at, updated_at
     FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, safeLimit, offset],
  );

  return {
    transactions: txRes.rows.map(toDTO),
    total,
    page: safePage,
    limit: safeLimit,
  };
}

// ─── Initialize top-up ────────────────────────────────────────────────────────

export async function initializeTopUp(
  userId: string,
  amount: number,
  paymentMethod: string,
): Promise<{ reference: string; authorizationUrl: string | null }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw domainError(422, 'VALIDATION_ERROR', 'Amount must be a positive number');
  }

  const userRes = await pool.query<{ email: string }>(
    'SELECT email FROM users WHERE id = $1',
    [userId],
  );
  const user = userRes.rows[0];
  if (!user) {
    throw domainError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const reference = makeReference('TP');

  await pool.query(
    `INSERT INTO transactions (user_id, type, status, amount, description, reference, metadata)
     VALUES ($1, 'top_up', 'pending', $2, $3, $4, $5)`,
    [
      userId,
      amount,
      'Wallet top-up',
      reference,
      JSON.stringify({ paymentMethod }),
    ],
  );

  // Paystack not configured → mock mode so the app still works pre-launch.
  if (!env.PAYSTACK_SECRET_KEY) {
    return { reference, authorizationUrl: null };
  }

  const init = await paystack.initializeTransaction({
    email: user.email,
    amount: nairaToKobo(amount),
    reference,
  });

  return { reference, authorizationUrl: init.authorizationUrl };
}

// ─── Verify & credit (idempotent) ─────────────────────────────────────────────

export async function verifyAndCredit(reference: string): Promise<TransactionDTO> {
  const txRes = await pool.query<TransactionRow>(
    `SELECT id, user_id, type, status, amount, description, reference, metadata, created_at, updated_at
     FROM transactions WHERE reference = $1`,
    [reference],
  );
  const tx = txRes.rows[0];
  if (!tx) {
    throw domainError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
  }

  // Idempotency: if already settled, return current state without re-crediting.
  if (tx.status !== 'pending') {
    return toDTO(tx);
  }

  const verification = await paystack.verifyTransaction(reference);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-read under row lock to guard against concurrent webhook + manual verify.
    const lockRes = await client.query<TransactionRow>(
      `SELECT id, user_id, type, status, amount, description, reference, metadata, created_at, updated_at
       FROM transactions WHERE reference = $1 FOR UPDATE`,
      [reference],
    );
    const locked = lockRes.rows[0];
    if (!locked || locked.status !== 'pending') {
      await client.query('COMMIT');
      return locked ? toDTO(locked) : toDTO(tx);
    }

    if (verification.status === 'success') {
      const updated = await client.query<TransactionRow>(
        `UPDATE transactions
         SET status = 'completed', updated_at = NOW()
         WHERE reference = $1
         RETURNING id, user_id, type, status, amount, description, reference, metadata, created_at, updated_at`,
        [reference],
      );
      // Atomic balance credit — never read-then-write.
      await client.query(
        'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
        [updated.rows[0].amount, updated.rows[0].user_id],
      );
      await client.query('COMMIT');
      return toDTO(updated.rows[0]);
    }

    const failed = await client.query<TransactionRow>(
      `UPDATE transactions
       SET status = 'failed', updated_at = NOW()
       WHERE reference = $1
       RETURNING id, user_id, type, status, amount, description, reference, metadata, created_at, updated_at`,
      [reference],
    );
    await client.query('COMMIT');
    return toDTO(failed.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Request withdrawal ───────────────────────────────────────────────────────

export async function requestWithdrawal(
  userId: string,
  amount: number,
  bankDetails: { accountName: string; accountNumber: string; bankName: string },
): Promise<TransactionDTO> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw domainError(422, 'VALIDATION_ERROR', 'Amount must be a positive number');
  }
  if (amount < MIN_WITHDRAWAL_NAIRA) {
    throw domainError(
      400,
      'AMOUNT_TOO_LOW',
      `Minimum withdrawal is ₦${MIN_WITHDRAWAL_NAIRA}`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the wallet row to serialize concurrent withdrawals.
    const walletRes = await client.query<{ balance: string }>(
      'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    const wallet = walletRes.rows[0];
    if (!wallet) {
      throw domainError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
    }

    if (Number(wallet.balance) < amount) {
      throw domainError(422, 'INSUFFICIENT_BALANCE', 'Insufficient wallet balance');
    }

    const reference = makeReference('WD');
    const last4 = bankDetails.accountNumber.slice(-4);

    const insertRes = await client.query<TransactionRow>(
      `INSERT INTO transactions (user_id, type, status, amount, description, reference, metadata)
       VALUES ($1, 'withdrawal', 'pending', $2, $3, $4, $5)
       RETURNING id, user_id, type, status, amount, description, reference, metadata, created_at, updated_at`,
      [
        userId,
        amount,
        `Withdrawal to ${bankDetails.bankName}`,
        reference,
        JSON.stringify({
          bankName: bankDetails.bankName,
          accountName: bankDetails.accountName,
          accountLast4: last4,
          fee: WITHDRAWAL_FEE_NAIRA,
        }),
      ],
    );

    // Atomic debit — never read-then-write.
    await client.query(
      'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
      [amount, userId],
    );

    await client.query('COMMIT');
    return toDTO(insertRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export const __testing = { nairaToKobo, koboToNaira, WITHDRAWAL_FEE_NAIRA, MIN_WITHDRAWAL_NAIRA };
