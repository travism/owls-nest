import { z } from 'zod';

export const ISODateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const InquiryCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name required').max(200),
    email: z.string().trim().email('Valid email required').max(320),
    phone: z.string().trim().min(1, 'Phone required').max(40),
    checkIn: ISODateSchema,
    checkOut: ISODateSchema,
    numGuests: z.number().int().min(1, 'At least 1 guest').max(20),
    petCount: z.number().int().min(0).max(2).default(0),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.checkOut > d.checkIn, {
    path: ['checkOut'],
    message: 'Check-out must be after check-in',
  });

export type InquiryCreate = z.infer<typeof InquiryCreateSchema>;
