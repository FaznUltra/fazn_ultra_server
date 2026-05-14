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

export async function createGame(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    if (!(req as any).user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Auth required' } });
      return;
    }
    const { name, platform, thumbnailUrl } = req.body;
    const game = await gameService.createGame({
      name,
      platform,
      thumbnailUrl,
      createdBy: (req as any).user.id,
    });
    res.status(201).json({ game });
  } catch (err) {
    next(err);
  }
}

export async function deleteGame(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const deleted = await gameService.deactivateGame(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: { code: 'GAME_NOT_FOUND', message: 'Game not found' } });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
