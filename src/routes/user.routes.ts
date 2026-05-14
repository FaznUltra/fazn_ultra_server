import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { me } from '../controllers/user.controller';

export const userRouter = Router();

userRouter.get('/me', authMiddleware, me);
