import { z } from 'zod';
import { ISODateSchema } from './inquiry.js';

export const BlockedDateReasonSchema = z.enum([
  'manual_block',
  'maintenance',
  'ota_booking',
]);
export type BlockedDateReason = z.infer<typeof BlockedDateReasonSchema>;

export const BlockedDateSchema = z.object({
  id: z.string().uuid(),
  startDate: ISODateSchema,
  endDate: ISODateSchema,
  reason: BlockedDateReasonSchema,
  sourcePlatform: z.string().nullable(),
  sourceSummary: z.string().nullable(),
});
export type BlockedDate = z.infer<typeof BlockedDateSchema>;

// Admin can only manually create blocks of reason manual_block | maintenance.
// OTA blocks come from iCal import.
export const BlockedDateCreateSchema = z
  .object({
    startDate: ISODateSchema,
    endDate: ISODateSchema,
    reason: z.enum(['manual_block', 'maintenance']).default('manual_block'),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.endDate > d.startDate, {
    path: ['endDate'],
    message: 'End date must be after start date',
  });
export type BlockedDateCreate = z.infer<typeof BlockedDateCreateSchema>;
