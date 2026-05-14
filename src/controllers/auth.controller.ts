import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clerkUserId = (req as any).user?.id as string;
    const user = await authService.getUserByClerkId(clerkUserId);
    if (!user) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not in database yet' } });
      return;
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function sync(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clerkUserId = (req as any).user?.id as string;
    const { email, username } = req.body;
    const user = await authService.findOrCreateUser(clerkUserId, email, username);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}
