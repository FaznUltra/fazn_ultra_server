import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as profileService from '../services/profile.service';
import * as privacyService from '../services/privacy.service';
import * as streamingService from '../services/streaming.service';

function handleValidation(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: errors.array() } });
    return false;
  }
  return true;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await profileService.getMyProfile((req as any).user.id);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function updateMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { firstName, lastName, username, bio, avatarUrl, tags } = req.body;
    const user = await profileService.updateMyProfile((req as any).user.id, {
      firstName,
      lastName,
      username,
      bio,
      avatarUrl,
      tags,
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function getPublicProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const user = await profileService.getPublicProfile(req.params.userId);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

// ─── Privacy ──────────────────────────────────────────────────────────────────

export async function getPrivacySettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await privacyService.getPrivacySettings((req as any).user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function updatePrivacySettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { showOnlineStatus, showStats, showRecentResults, allowChallengesFrom } = req.body;
    const data = await privacyService.updatePrivacySettings((req as any).user.id, {
      showOnlineStatus,
      showStats,
      showRecentResults,
      allowChallengesFrom,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export async function getStreamingChannels(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await streamingService.getStreamingChannels((req as any).user.id);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function connectChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const { channelId, channelName, channelUrl } = req.body;
    const channel = await streamingService.connectChannel((req as any).user.id, {
      provider: req.params.provider,
      channelId,
      channelName,
      channelUrl,
    });
    res.json({ data: channel });
  } catch (err) {
    next(err);
  }
}

export async function disconnectChannel(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    await streamingService.disconnectChannel((req as any).user.id, req.params.provider);
    res.json({ message: 'Channel disconnected' });
  } catch (err) {
    next(err);
  }
}
