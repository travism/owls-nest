import { z } from 'zod';

export const SetupPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
});

export const SetupVerifySchema = z.object({
  setupToken: z.string().min(20),
  totpCode: z.string().regex(/^\d{6}$/),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const TotpSchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().regex(/^\d{6}$/),
});

export const RecoverySchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().min(8).max(40),
});
