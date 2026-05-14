import { Router } from 'express';
import { body } from 'express-validator';
import { me, sync } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

export const authRouter = Router();

authRouter.use(authMiddleware);

authRouter.get('/me', me);

authRouter.post(
  '/sync',
  [body('email').isEmail().normalizeEmail(), body('username').isString().isLength({ min: 3, max: 32 })],
  sync,
);
