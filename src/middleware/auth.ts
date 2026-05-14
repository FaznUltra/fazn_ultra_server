import { NextFunction, Request, Response } from 'express';
import { verifyToken } from '@clerk/backend';
import { env } from '../config/env';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Missing bearer token' } });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    (req as any).user = { id: payload.sub, email: '', role: 'player' };
    next();
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
}
