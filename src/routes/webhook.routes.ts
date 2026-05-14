import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { env } from '../config/env';
import { findOrCreateUser } from '../services/auth.service';

export const webhookRouter = Router();

webhookRouter.post('/clerk', async (req: Request, res: Response): Promise<void> => {
  const svixId = req.headers['svix-id'] as string;
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  const svixSignature = req.headers['svix-signature'] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    res.status(400).json({ error: 'Missing svix headers' });
    return;
  }

  let payload: any;
  try {
    const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
    payload = wh.verify(JSON.stringify(req.body), {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  } catch {
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  if (payload.type === 'user.created') {
    const { id, email_addresses, username } = payload.data;
    const email = email_addresses?.[0]?.email_address ?? '';
    const name = username ?? email.split('@')[0];

    try {
      await findOrCreateUser(id, email, name);
      console.log(`✅ User synced from Clerk: ${email}`);
    } catch (err) {
      console.error('❌ Failed to sync user:', err);
      res.status(500).json({ error: 'Failed to create user' });
      return;
    }
  }

  res.json({ received: true });
});
