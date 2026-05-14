import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  DATABASE_URL: required('DATABASE_URL'),

  // JWT
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),

  // Resend (email)
  RESEND_API_KEY: required('RESEND_API_KEY'),
  RESEND_FROM: required('RESEND_FROM'),

  // Google OAuth
  GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
  GOOGLE_CALLBACK_URL: required('GOOGLE_CALLBACK_URL'),

  // Apple OAuth
  APPLE_CLIENT_ID: required('APPLE_CLIENT_ID'),
  APPLE_TEAM_ID: required('APPLE_TEAM_ID'),
  APPLE_KEY_ID: required('APPLE_KEY_ID'),
  APPLE_PRIVATE_KEY: required('APPLE_PRIVATE_KEY'),
  APPLE_CALLBACK_URL: required('APPLE_CALLBACK_URL'),

  // Frontend deep-link redirect after OAuth
  FRONTEND_REDIRECT_URL: required('FRONTEND_REDIRECT_URL'),
} as const;

export type Env = typeof env;
