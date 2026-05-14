import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as gameService from '../services/game.service';

function handleValidation(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: errors.array() },
    });
    return false;
  }
  return true;
}

export async function listGames(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const games = await gameService.listActiveGames();
    res.json({ games });
  } catch (err) {
    next(err);
  }
}

export async function listAllGames(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const games = await gameService.listAllGames();
    res.json({ games });
  } catch (err) {
    next(err);
  }
}

export async function createGame(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { name, category, platforms, thumbnailUrl, scoreType } = req.body;
    const game = await gameService.createGame({
      name,
      category,
      platforms,
      thumbnailUrl,
      scoreType,
      createdBy: (req as any).user.id,
    });
    res.status(201).json({ game });
  } catch (err) {
    next(err);
  }
}

export async function toggleGame(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { active } = req.body;
    const game = await gameService.toggleGameActive(req.params.id, active);
    if (!game) {
      res.status(404).json({ error: { code: 'GAME_NOT_FOUND', message: 'Game not found' } });
      return;
    }
    res.json({ game });
  } catch (err) {
    next(err);
  }
}

export async function getValidOptions(_req: Request, res: Response): Promise<void> {
  res.json({
    categories: gameService.VALID_CATEGORIES,
    platforms: gameService.VALID_PLATFORMS,
    scoreTypes: gameService.VALID_SCORE_TYPES,
  });
}
