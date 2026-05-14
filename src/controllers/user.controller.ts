import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/client';

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!(req as any).user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Auth required' } });
      return;
    }
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.created_at,
              COALESCE(w.balance, 0) AS wallet_balance
         FROM users u
         LEFT JOIN wallets w ON w.user_id = u.id
        WHERE u.id = $1`,
      [(req as any).user.id],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      return;
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
}
