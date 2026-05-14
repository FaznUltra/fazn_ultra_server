import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authRouter } from './auth.routes';
import { userRouter } from './user.routes';
import { gameRouter, adminGameRouter } from './game.routes';
import { webhookRouter } from './webhook.routes';

export const router = Router();

router.use('/health', healthRouter);
router.use('/webhooks', webhookRouter);

const v1 = Router();
v1.use('/auth', authRouter);
v1.use('/users', userRouter);
v1.use('/games', gameRouter);
v1.use('/admin/games', adminGameRouter);

router.use('/api/v1', v1);
