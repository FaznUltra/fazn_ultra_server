import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { router } from './routes';

export const app = express();

app.use(helmet());
app.use(cors());

// Raw body needed for Clerk webhook signature verification
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '100kb' }));

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
