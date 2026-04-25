import { z } from 'zod';

export const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, 'Time must be HH:MM:SS');

export const CancellationTierSchema = z.object({
  daysBeforeCheckin: z.number().int().min(0),
  refundPercent: z.number().int().min(0).max(100),
});

export const CancellationPolicySchema = z.object({
  tiers: z.array(CancellationTierSchema).min(1).max(10),
});

export const PropertySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  addressLine1: z.string(),
  city: z.string(),
  state: z.string().length(2),
  postalCode: z.string(),
  checkInTime: TimeOfDaySchema,
  checkOutTime: TimeOfDaySchema,
  maxGuests: z.number().int().min(1).max(20),
  baseNightlyRate: z.number().nonnegative(),
  cleaningFee: z.number().nonnegative(),
  minStay: z.number().int().min(1).max(30),
  cancellationPolicy: CancellationPolicySchema,
});
export type Property = z.infer<typeof PropertySchema>;

// Body for PATCH /api/v1/property — every field optional, but at least
// one must be present. Refines + transforms strings to numbers where
// the form sends strings (we prefer client-side coercion at the form).
export const PropertyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    addressLine1: z.string().trim().min(1).max(300).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    state: z.string().trim().length(2).optional(),
    postalCode: z.string().trim().min(3).max(20).optional(),
    checkInTime: TimeOfDaySchema.optional(),
    checkOutTime: TimeOfDaySchema.optional(),
    maxGuests: z.number().int().min(1).max(20).optional(),
    baseNightlyRate: z.number().nonnegative().optional(),
    cleaningFee: z.number().nonnegative().optional(),
    minStay: z.number().int().min(1).max(30).optional(),
    cancellationPolicy: CancellationPolicySchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field is required',
  });
export type PropertyUpdate = z.infer<typeof PropertyUpdateSchema>;
