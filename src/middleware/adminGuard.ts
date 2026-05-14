import { NextFunction, Request, Response } from 'express';

export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  if (!(req as any).user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    return;
  }
  if ((req as any).user.role !== 'admin') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin role required' } });
    return;
  }
  next();
}
