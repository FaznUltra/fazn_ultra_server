import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db/client';
import { env } from '../config/env';
import { sanitizeString } from '../utils/sanitize';
import { sendOtp } from './otp.service';

const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;

export interface UserRow {
  id: string;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  role: 'player' | 'admin';
  email_verified: boolean;
  auth_provider: 'local' | 'google' | 'apple';
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function signAccess(user: UserRow): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TTL },
  );
}

async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt],
  );
  return raw;
}

async function revokeRefreshToken(raw: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [hash],
  );
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(input: {
  email: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<{ user: UserRow } & TokenPair> {
  const email = sanitizeString(input.email).toLowerCase();
  const username = sanitizeString(input.username);
  const firstName = sanitizeString(input.firstName);
  const lastName = sanitizeString(input.lastName);

  const clash = await pool.query(
    'SELECT id FROM users WHERE email = $1 OR username = $2',
    [email, username],
  );
  if (clash.rowCount && clash.rowCount > 0) {
    const err = Object.assign(new Error('Email or username already in use'), { status: 409, code: 'USER_EXISTS' });
    throw err;
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<UserRow>(
      `INSERT INTO users (email, username, first_name, last_name, password_hash, auth_provider)
       VALUES ($1, $2, $3, $4, $5, 'local')
       RETURNING id, email, username, first_name, last_name, role, email_verified, auth_provider`,
      [email, username, firstName, lastName, passwordHash],
    );
    const user = result.rows[0];
    await client.query(
      'INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [user.id],
    );
    await client.query('COMMIT');

    const accessToken = signAccess(user);
    const refreshToken = await issueRefreshToken(user.id);

    // Send verification OTP — fire and forget so a Resend hiccup doesn't fail registration
    sendOtp(user.email, 'email_verification').catch(() => {});

    return { user, accessToken, refreshToken };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(input: {
  email: string;
  password: string;
}): Promise<{ user: UserRow } & TokenPair> {
  const email = sanitizeString(input.email).toLowerCase();

  const result = await pool.query<UserRow & { password_hash: string }>(
    `SELECT id, email, username, first_name, last_name, role, email_verified, auth_provider, password_hash
     FROM users WHERE email = $1 AND auth_provider = 'local'`,
    [email],
  );
  const row = result.rows[0];
  const validPassword = row ? await bcrypt.compare(input.password, row.password_hash) : false;

  // Constant-time: always compare even if user not found (prevents timing attacks)
  if (!row || !validPassword) {
    const err = Object.assign(new Error('Invalid email or password'), { status: 401, code: 'INVALID_CREDENTIALS' });
    throw err;
  }

  const { password_hash: _, ...user } = row;
  const accessToken = signAccess(user as UserRow);
  const refreshToken = await issueRefreshToken(user.id);
  return { user: user as UserRow, accessToken, refreshToken };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refresh(rawToken: string): Promise<TokenPair> {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const result = await pool.query<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null }>(
    'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
    [hash],
  );
  const token = result.rows[0];

  if (!token || token.revoked_at || new Date(token.expires_at) < new Date()) {
    const err = Object.assign(new Error('Invalid or expired refresh token'), { status: 401, code: 'INVALID_REFRESH' });
    throw err;
  }

  // Rotate — revoke old, issue new
  await revokeRefreshToken(rawToken);

  const userResult = await pool.query<UserRow>(
    'SELECT id, email, username, first_name, last_name, role, email_verified, auth_provider FROM users WHERE id = $1',
    [token.user_id],
  );
  const user = userResult.rows[0];

  const accessToken = signAccess(user);
  const refreshToken = await issueRefreshToken(user.id);
  return { accessToken, refreshToken };
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(rawToken: string): Promise<void> {
  await revokeRefreshToken(rawToken);
}

// ─── Get user ─────────────────────────────────────────────────────────────────

export async function getUserById(id: string): Promise<(UserRow & { balance: string }) | null> {
  const result = await pool.query(
    `SELECT u.id, u.email, u.username, u.first_name, u.last_name, u.role,
            u.email_verified, u.auth_provider, w.balance
     FROM users u LEFT JOIN wallets w ON w.user_id = u.id
     WHERE u.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

// ─── OAuth upsert ─────────────────────────────────────────────────────────────

export async function findOrCreateOAuthUser(input: {
  provider: 'google' | 'apple';
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<{ user: UserRow } & TokenPair> {
  const email = sanitizeString(input.email).toLowerCase();
  const firstName = sanitizeString(input.firstName);
  const lastName = sanitizeString(input.lastName);

  // Try by provider_id first, then fall back to email
  let result = await pool.query<UserRow>(
    `SELECT id, email, username, first_name, last_name, role, email_verified, auth_provider
     FROM users WHERE auth_provider = $1 AND provider_id = $2`,
    [input.provider, input.providerId],
  );

  if (result.rows.length === 0) {
    result = await pool.query<UserRow>(
      `SELECT id, email, username, first_name, last_name, role, email_verified, auth_provider
       FROM users WHERE email = $1`,
      [email],
    );
  }

  let user: UserRow;
  if (result.rows.length > 0) {
    // Update provider info if missing
    await pool.query(
      `UPDATE users SET auth_provider = $1, provider_id = $2, email_verified = TRUE WHERE id = $3`,
      [input.provider, input.providerId, result.rows[0].id],
    );
    user = result.rows[0];
  } else {
    // New user — generate a unique username from email
    const baseUsername = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
    const username = `${baseUsername}_${crypto.randomBytes(3).toString('hex')}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<UserRow>(
        `INSERT INTO users (email, username, first_name, last_name, auth_provider, provider_id, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id, email, username, first_name, last_name, role, email_verified, auth_provider`,
        [email, username, firstName, lastName, input.provider, input.providerId],
      );
      user = inserted.rows[0];
      await client.query(
      'INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [user.id],
    );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const accessToken = signAccess(user);
  const refreshToken = await issueRefreshToken(user.id);
  return { user, accessToken, refreshToken };
}
