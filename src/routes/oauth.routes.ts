import { Router } from 'express';
import { googleRedirect, googleCallback, appleRedirect, appleCallback } from '../controllers/oauth.controller';

export const oauthRouter = Router();

oauthRouter.get('/google', googleRedirect);
oauthRouter.get('/google/callback', googleCallback);

oauthRouter.get('/apple', appleRedirect);
oauthRouter.post('/apple/callback', appleCallback); // Apple uses POST for form_post response_mode
