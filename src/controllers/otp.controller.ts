import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as otpService from '../services/otp.service';
import * as authService from '../services/auth.service';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client';
import { sanitizeString } from '../utils/sanitize';

function handleValidation(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: errors.array() } });
    return false;
  }
  return true;
}

export async function sendVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const email = sanitizeString(req.body.email).toLowerCase();
    await otpService.sendOtp(email, 'email_verification');
    res.json({ message: 'Verification code sent' });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const email = sanitizeString(req.body.email).toLowerCase();
    const { otp } = req.body;
    const valid = await otpService.verifyOtp(email, otp, 'email_verification');
    if (!valid) {
      res.status(400).json({ error: { code: 'INVALID_OTP', message: 'Invalid or expired code' } });
      return;
    }
    res.json({ message: 'Email verified' });
  } catch (err) {
    next(err);
  }
}

export async function sendPasswordReset(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const email = sanitizeString(req.body.email).toLowerCase();
    // Always return 200 — don't reveal if email exists
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (user.rowCount && user.rowCount > 0) {
      await otpService.sendOtp(email, 'password_reset');
    }
    res.json({ message: 'If that email exists, a reset code has been sent' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!handleValidation(req, res)) return;
  try {
    const email = sanitizeString(req.body.email).toLowerCase();
    const { otp, newPassword } = req.body;
    const valid = await otpService.verifyOtp(email, otp, 'password_reset');
    if (!valid) {
      res.status(400).json({ error: { code: 'INVALID_OTP', message: 'Invalid or expired code' } });
      return;
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, email]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}
