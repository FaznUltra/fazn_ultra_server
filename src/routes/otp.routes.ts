import { Router } from 'express';
import { body } from 'express-validator';
import { sendVerification, verifyEmail, sendPasswordReset, resetPassword } from '../controllers/otp.controller';

export const otpRouter = Router();

otpRouter.post(
  '/send-verification',
  [body('email').isEmail().normalizeEmail()],
  sendVerification,
);

otpRouter.post(
  '/verify-email',
  [body('email').isEmail().normalizeEmail(), body('otp').isString().isLength({ min: 6, max: 6 })],
  verifyEmail,
);

otpRouter.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  sendPasswordReset,
);

otpRouter.post(
  '/reset-password',
  [
    body('email').isEmail().normalizeEmail(),
    body('otp').isString().isLength({ min: 6, max: 6 }),
    body('newPassword').isString().isLength({ min: 8, max: 128 }),
  ],
  resetPassword,
);
