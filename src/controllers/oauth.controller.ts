import { Request, Response, NextFunction } from 'express';
import * as googleService from '../services/google.service';
import * as appleService from '../services/apple.service';
import { findOrCreateOAuthUser } from '../services/auth.service';
import { env } from '../config/env';

// ─── Google ───────────────────────────────────────────────────────────────────

export function googleRedirect(_req: Request, res: Response): void {
  res.redirect(googleService.getGoogleAuthUrl());
}

export async function googleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).json({ error: { code: 'MISSING_CODE', message: 'Missing OAuth code' } });
      return;
    }
    const profile = await googleService.exchangeGoogleCode(code);
    const { accessToken, refreshToken } = await findOrCreateOAuthUser({ provider: 'google', ...profile });
    // Redirect to mobile deep link with tokens
    const redirect = `${env.FRONTEND_REDIRECT_URL}?accessToken=${accessToken}&refreshToken=${refreshToken}`;
    res.redirect(redirect);
  } catch (err) {
    next(err);
  }
}

// ─── Apple ────────────────────────────────────────────────────────────────────

export function appleRedirect(_req: Request, res: Response): void {
  res.redirect(appleService.getAppleAuthUrl());
}

export async function appleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code, user: userJson } = req.body;
    if (!code) {
      res.status(400).json({ error: { code: 'MISSING_CODE', message: 'Missing OAuth code' } });
      return;
    }
    const appleUser = userJson ? JSON.parse(userJson) : {};
    const profile = await appleService.exchangeAppleCode(code, appleUser);
    const { accessToken, refreshToken } = await findOrCreateOAuthUser({ provider: 'apple', ...profile });
    const redirect = `${env.FRONTEND_REDIRECT_URL}?accessToken=${accessToken}&refreshToken=${refreshToken}`;
    res.redirect(redirect);
  } catch (err) {
    next(err);
  }
}
