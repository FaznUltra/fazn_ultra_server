import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { createHmac, timingSafeEqual } from 'crypto';
import * as walletService from '../services/wallet.service';
import { pool } from '../db/client';
import { env } from '../config/env';

function handleValidation(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: errors.array() },
    });
    return false;
  }
  return true;
}

// ─── GET /wallet ──────────────────────────────────────────────────────────────

export async function getWallet(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await walletService.getWallet((req as any).user.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

// ─── GET /wallet/transactions ─────────────────────────────────────────────────

export async function getTransactions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const limit = parseInt(String(req.query.limit ?? '20'), 10);
    const data = await walletService.getTransactions((req as any).user.id, page, limit);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

// ─── POST /wallet/topup ───────────────────────────────────────────────────────

export async function initializeTopUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { amount, paymentMethod } = req.body;
    const result = await walletService.initializeTopUp(
      (req as any).user.id,
      Number(amount),
      String(paymentMethod ?? 'paystack_card'),
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── POST /wallet/topup/verify ────────────────────────────────────────────────

export async function verifyTopUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { reference } = req.body;
    const transaction = await walletService.verifyAndCredit(String(reference));
    res.json({ status: transaction.status, transaction });
  } catch (err) {
    next(err);
  }
}

// ─── POST /wallet/withdraw ────────────────────────────────────────────────────

export async function requestWithdrawal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { amount, accountName, accountNumber, bankName } = req.body;
    const transaction = await walletService.requestWithdrawal((req as any).user.id, Number(amount), {
      accountName: String(accountName),
      accountNumber: String(accountNumber),
      bankName: String(bankName),
    });
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
}

// ─── POST /wallet/webhook ─────────────────────────────────────────────────────
// No auth middleware. Verifies HMAC-SHA512 signature of the raw body.

export async function paystackWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const secret = env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      // Not configured — accept silently so Paystack does not retry forever.
      res.status(200).json({ received: true });
      return;
    }

    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}));

    const signature = req.header('x-paystack-signature') ?? '';
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
      return;
    }

    let event: { event?: string; id?: string | number; data?: { reference?: string } };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Malformed payload' } });
      return;
    }

    const eventId = String(event.id ?? `${event.event}:${event.data?.reference ?? ''}`);
    const eventType = String(event.event ?? 'unknown');

    // Idempotent: skip if we've already recorded this event.
    const inserted = await pool.query(
      `INSERT INTO paystack_events (event_id, event_type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [eventId, eventType, JSON.stringify(event)],
    );

    if (inserted.rowCount === 0) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    if (eventType === 'charge.success' && event.data?.reference) {
      await walletService.verifyAndCredit(event.data.reference);
    }

    await pool.query('UPDATE paystack_events SET processed = TRUE WHERE event_id = $1', [eventId]);

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
