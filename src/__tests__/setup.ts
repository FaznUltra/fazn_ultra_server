import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_ENV = 'test';

// Ensure required test env vars have fallback values so tests run without real secrets
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? 'test_key';
process.env.RESEND_FROM = process.env.RESEND_FROM ?? 'FAZN <noreply@fazn.dev>';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'test';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'test';
process.env.GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3001/api/v1/auth/oauth/google/callback';
process.env.APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID ?? 'test';
process.env.APPLE_TEAM_ID = process.env.APPLE_TEAM_ID ?? 'test';
process.env.APPLE_KEY_ID = process.env.APPLE_KEY_ID ?? 'test';
process.env.APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY ?? 'test';
process.env.APPLE_CALLBACK_URL = process.env.APPLE_CALLBACK_URL ?? 'http://localhost:3001/api/v1/auth/oauth/apple/callback';
process.env.FRONTEND_REDIRECT_URL = process.env.FRONTEND_REDIRECT_URL ?? 'fazn://auth';
