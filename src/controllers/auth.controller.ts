import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as authService from '../services/auth.service';

function handleValidation(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: errors.array() } });
    return false;
  }
  return true;
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { email, username, password, firstName, lastName } = req.body;
    const result = await authService.register({ email, username, password, firstName, lastName });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { refreshToken } = req.body;
    const tokens = await authService.refresh(refreshToken);
    res.json(tokens);
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getUserById((req as any).user.id);
    if (!user) {
      res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      return;
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
}
