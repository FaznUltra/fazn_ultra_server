import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  getMyProfile,
  updateMyProfile,
  getPublicProfile,
  getPrivacySettings,
  updatePrivacySettings,
  getStreamingChannels,
  connectChannel,
  disconnectChannel,
} from '../controllers/profile.controller';
import { authMiddleware } from '../middleware/auth';

export const profileRouter = Router();

// All profile routes require authentication.
profileRouter.use(authMiddleware);

// ─── My profile ───────────────────────────────────────────────────────────────

profileRouter.get('/', getMyProfile);

profileRouter.patch(
  '/',
  [
    body('firstName').optional().isString().trim().isLength({ min: 1, max: 64 }),
    body('lastName').optional().isString().trim().isLength({ min: 1, max: 64 }),
    body('username').optional().isString().trim().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/),
    body('bio').optional().isString().isLength({ max: 160 }),
    body('avatarUrl').optional().isURL(),
    body('tags').optional().isArray({ max: 10 }),
    body('tags.*').optional().isString().isLength({ max: 20 }),
  ],
  updateMyProfile,
);

// ─── Privacy (most specific — declared before /:userId) ───────────────────────

profileRouter.get('/privacy', getPrivacySettings);

profileRouter.patch(
  '/privacy',
  [
    body('showOnlineStatus').optional().isBoolean(),
    body('showStats').optional().isBoolean(),
    body('showRecentResults').optional().isBoolean(),
    body('allowChallengesFrom').optional().isIn(['everyone', 'friends', 'nobody']),
  ],
  updatePrivacySettings,
);

// ─── Streaming (declared before /:userId) ─────────────────────────────────────

profileRouter.get('/streaming', getStreamingChannels);

profileRouter.post(
  '/streaming/:provider',
  [
    param('provider').isIn(['youtube', 'twitch']),
    body('channelId').isString().notEmpty(),
    body('channelName').isString().notEmpty().isLength({ max: 100 }),
    body('channelUrl').isURL(),
  ],
  connectChannel,
);

profileRouter.delete(
  '/streaming/:provider',
  [param('provider').isIn(['youtube', 'twitch'])],
  disconnectChannel,
);

// ─── Public profile (least specific — must be last) ───────────────────────────

profileRouter.get('/:userId', [param('userId').isUUID()], getPublicProfile);
