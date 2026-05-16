import { Router, Request, Response } from 'express';
import { body, query } from 'express-validator';
import {
  getWallet,
  getTransactions,
  initializeTopUp,
  verifyTopUp,
  requestWithdrawal,
  paystackWebhook,
} from '../controllers/wallet.controller';
import { authMiddleware } from '../middleware/auth';

export const walletRouter = Router();

// ─── Webhook (no auth — verified via Paystack HMAC signature) ─────────────────
// Raw-body parsing for this path is configured in app.ts.
walletRouter.post('/webhook', paystackWebhook);

// ─── Paystack redirect (public — browser GET after payment) ──────────────────
// Paystack redirects here after the user completes payment on their page.
// We immediately redirect to the app deep link so expo-web-browser can
// intercept it and close the in-app browser, then the app calls /topup/verify.
walletRouter.get('/redirect', (req: Request, res: Response) => {
  const reference = String(req.query.reference ?? req.query.trxref ?? '');
  // fazn:// is the app scheme registered in app.json
  res.redirect(302, `fazn://paystack?reference=${encodeURIComponent(reference)}`);
});

// ─── Authenticated wallet routes ──────────────────────────────────────────────
walletRouter.use(authMiddleware);

walletRouter.get('/', getWallet);

walletRouter.get(
  '/transactions',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  getTransactions,
);

walletRouter.post(
  '/topup',
  [
    body('amount').isFloat({ gt: 0 }),
    body('paymentMethod')
      .optional()
      .isIn(['paystack_card', 'paystack_bank', 'paystack_ussd', 'bank_transfer']),
  ],
  initializeTopUp,
);

walletRouter.post(
  '/topup/verify',
  [body('reference').isString().trim().notEmpty()],
  verifyTopUp,
);

walletRouter.post(
  '/withdraw',
  [
    body('amount').isFloat({ gt: 0 }),
    body('accountName').isString().trim().notEmpty().isLength({ max: 100 }),
    body('accountNumber').isString().trim().notEmpty().isLength({ min: 4, max: 20 }),
    body('bankName').isString().trim().notEmpty().isLength({ max: 100 }),
  ],
  requestWithdrawal,
);
