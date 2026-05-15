import { Router } from 'express';
import { body } from 'express-validator';
import { register, login, refresh, logout, me } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

export const authRouter = Router();

authRouter.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('username').isString().trim().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
    body('password').isString().isLength({ min: 8, max: 128 }),
    body('firstName').isString().trim().isLength({ min: 1, max: 64 }),
    body('lastName').isString().trim().isLength({ min: 1, max: 64 }),
  ],
  register,
);

authRouter.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty(),
  ],
  login,
);

authRouter.post(
  '/refresh',
  [body('refreshToken').isString().isLength({ min: 10 })],
  refresh,
);

authRouter.post(
  '/logout',
  [body('refreshToken').isString().isLength({ min: 10 })],
  logout,
);

authRouter.get('/me', authMiddleware, me);
