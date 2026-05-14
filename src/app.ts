import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { router } from './routes';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use(router);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// Centralised error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; code?: string; details?: unknown }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  const code = err.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'error', msg: 'request.error', code, status, error: err.message }));
  res.status(status).json({
    error: {
      code,
      message: status === 500 ? 'Internal server error' : err.message,
      details: err.details,
    },
  });
});
