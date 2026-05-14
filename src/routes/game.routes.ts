import { Router } from 'express';
import { body, param } from 'express-validator';
import { authMiddleware } from '../middleware/auth';
import { adminGuard } from '../middleware/adminGuard';
import { listGames, createGame, deleteGame } from '../controllers/game.controller';

export const gameRouter = Router();
gameRouter.get('/', listGames);

export const adminGameRouter = Router();
adminGameRouter.use(authMiddleware, adminGuard);

adminGameRouter.post(
  '/',
  [
    body('name').isString().isLength({ min: 1, max: 120 }),
    body('platform').isString().isLength({ min: 1, max: 50 }),
    body('thumbnailUrl').optional().isURL(),
  ],
  createGame,
);

adminGameRouter.delete('/:id', [param('id').isUUID()], deleteGame);
