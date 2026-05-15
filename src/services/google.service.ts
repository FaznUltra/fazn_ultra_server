import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';

const client = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL,
);

export function getGoogleAuthUrl(): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
  });
}

export async function exchangeGoogleCode(code: string): Promise<{
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
}> {
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw Object.assign(new Error('Invalid Google token'), { status: 400, code: 'INVALID_GOOGLE_TOKEN' });
  }

  return {
    providerId: payload.sub,
    email: payload.email,
    firstName: payload.given_name ?? '',
    lastName: payload.family_name ?? '',
  };
}
