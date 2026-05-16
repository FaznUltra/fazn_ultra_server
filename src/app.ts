import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { router } from './routes';

export const app = express();

app.use(helmet());
app.use(cors());

// Raw body needed for webhook signature verification (Clerk + Paystack).
// These paths must NOT be JSON-parsed so we can verify the HMAC of the exact bytes.
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use('/api/v1/wallet/webhook', express.raw({ type: '*/*' }));
app.use((req, res, next) => {
  if (req.path === '/api/v1/wallet/webhook') return next();
  return express.json({ limit: '100kb' })(req, res, next);
});

// Global rate limit — 100 requests per minute per IP
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
  }),
);

// Stricter limit on auth-adjacent and admin routes
const strictLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});
app.use('/api/v1/auth', strictLimit);
app.use('/api/v1/admin', strictLimit);

// Stricter limit on profile mutations only (reads stay on the global limit)
app.use('/api/v1/profile', (req, res, next) => {
  if (req.method === 'GET') return next();
  return strictLimit(req, res, next);
});

app.use(router);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; code?: string; details?: unknown }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  const code = err.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');
  console.error(JSON.stringify({ level: 'error', msg: 'request.error', code, status, error: err.message }));
  res.status(status).json({
    error: {
      code,
      message: status === 500 ? 'Internal server error' : err.message,
      details: err.details,
    },
  });
});
