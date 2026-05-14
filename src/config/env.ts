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
  CLERK_SECRET_KEY: required('CLERK_SECRET_KEY'),
  CLERK_WEBHOOK_SECRET: required('CLERK_WEBHOOK_SECRET'),
} as const;

export type Env = typeof env;
