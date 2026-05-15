import appleSignin from 'apple-signin-auth';
import { env } from '../config/env';

export function getAppleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: env.APPLE_CLIENT_ID,
    redirect_uri: env.APPLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'name email',
    response_mode: 'form_post',
  });
  return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
}

export async function exchangeAppleCode(
  code: string,
  appleUser: { name?: { firstName?: string; lastName?: string } },
): Promise<{
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
}> {
  const clientSecret = appleSignin.getClientSecret({
    clientID: env.APPLE_CLIENT_ID,
    teamID: env.APPLE_TEAM_ID,
    privateKey: env.APPLE_PRIVATE_KEY,
    keyIdentifier: env.APPLE_KEY_ID,
  });

  const tokens = await appleSignin.getAuthorizationToken(code, {
    clientID: env.APPLE_CLIENT_ID,
    redirectUri: env.APPLE_CALLBACK_URL,
    clientSecret,
  });

  const idToken = await appleSignin.verifyIdToken(tokens.id_token, {
    audience: env.APPLE_CLIENT_ID,
    ignoreExpiration: false,
  });

  if (!idToken.email) {
    throw Object.assign(new Error('Apple did not return an email'), { status: 400, code: 'INVALID_APPLE_TOKEN' });
  }

  return {
    providerId: idToken.sub,
    email: idToken.email,
    firstName: appleUser?.name?.firstName ?? '',
    lastName: appleUser?.name?.lastName ?? '',
  };
}
