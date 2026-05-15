import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: 'player' | 'admin';
  iat: number;
  exp: number;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Missing bearer token' } });
    return;
  }

  const token = header.slice(7).trim();
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    (req as any).user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: 'Access token expired' } });
    } else {
      res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
    }
  }
}
