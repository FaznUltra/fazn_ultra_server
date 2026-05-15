import crypto from 'crypto';
import { Resend } from 'resend';
import { pool } from '../db/client';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);
const OTP_TTL_MINUTES = 15;

function generateOtp(): string {
  // 6-digit numeric OTP
  return String(crypto.randomInt(100000, 999999));
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

export async function sendOtp(email: string, type: 'email_verification' | 'password_reset'): Promise<void> {
  // Invalidate any existing unused OTPs for this email+type
  await pool.query(
    `UPDATE otp_codes SET used_at = NOW()
     WHERE email = $1 AND type = $2 AND used_at IS NULL AND expires_at > NOW()`,
    [email, type],
  );

  const otp = generateOtp();
  const codeHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  await pool.query(
    'INSERT INTO otp_codes (email, code_hash, type, expires_at) VALUES ($1, $2, $3, $4)',
    [email, codeHash, type, expiresAt],
  );

  const subject = type === 'email_verification' ? 'Verify your FAZN email' : 'Reset your FAZN password';
  const body = type === 'email_verification'
    ? `Your FAZN verification code is: <strong>${otp}</strong><br>Expires in ${OTP_TTL_MINUTES} minutes.`
    : `Your FAZN password reset code is: <strong>${otp}</strong><br>Expires in ${OTP_TTL_MINUTES} minutes.`;

  await resend.emails.send({
    from: env.RESEND_FROM,
    to: email,
    subject,
    html: `<p>${body}</p>`,
  });
}

export async function verifyOtp(
  email: string,
  otp: string,
  type: 'email_verification' | 'password_reset',
): Promise<boolean> {
  const codeHash = hashOtp(otp);

  const result = await pool.query(
    `SELECT id FROM otp_codes
     WHERE email = $1 AND code_hash = $2 AND type = $3
       AND used_at IS NULL AND expires_at > NOW()`,
    [email, codeHash, type],
  );

  if (result.rowCount === 0) return false;

  // Mark as used
  await pool.query('UPDATE otp_codes SET used_at = NOW() WHERE id = $1', [result.rows[0].id]);

  if (type === 'email_verification') {
    await pool.query('UPDATE users SET email_verified = TRUE WHERE email = $1', [email]);
  }

  return true;
}
