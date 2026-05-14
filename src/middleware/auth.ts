import { NextFunction, Request, Response } from 'express';

// Placeholder — will be replaced with JWT implementation in Step 11
export async function authMiddleware(_req: Request, res: Response, _next: NextFunction): Promise<void> {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Auth middleware not yet configured' } });
}
