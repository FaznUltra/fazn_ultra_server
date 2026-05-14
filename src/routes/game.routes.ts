import { Router } from 'express';
import { body, param } from 'express-validator';
import { authMiddleware } from '../middleware/auth';
import { adminGuard } from '../middleware/adminGuard';
import { listGames, listAllGames, createGame, toggleGame, getValidOptions } from '../controllers/game.controller';
import { VALID_CATEGORIES, VALID_PLATFORMS, VALID_SCORE_TYPES } from '../services/game.service';

export const gameRouter = Router();
gameRouter.get('/', listGames);
gameRouter.get('/options', getValidOptions);

export const adminGameRouter = Router();
adminGameRouter.use(authMiddleware, adminGuard);

adminGameRouter.get('/', listAllGames);

adminGameRouter.post(
  '/',
  [
    body('name').isString().isLength({ min: 1, max: 120 }),
    body('category').isIn(VALID_CATEGORIES),
    body('platforms').isArray({ min: 1 }).custom((arr: string[]) =>
      arr.every(p => VALID_PLATFORMS.includes(p)),
    ),
    body('scoreType').isIn(VALID_SCORE_TYPES),
    body('thumbnailUrl').optional().isURL(),
  ],
  createGame,
);

adminGameRouter.patch(
  '/:id/toggle',
  [param('id').isUUID(), body('active').isBoolean()],
  toggleGame,
);
