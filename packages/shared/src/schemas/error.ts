import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_INVALID',
  'NOT_FOUND',
  'CONFLICT',
  'MFA_REQUIRED',
  'MIN_STAY_VIOLATION',
  'DOUBLE_BOOKING',
  'WEBHOOK_SIGNATURE_INVALID',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
