import { z } from 'zod';

export const ISODateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const InquiryCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name required').max(200),
    email: z.string().trim().email('Valid email required').max(320),
    phone: z.string().trim().max(40).optional(),
    checkIn: ISODateSchema,
    checkOut: ISODateSchema,
    message: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.checkOut > d.checkIn, {
    path: ['checkOut'],
    message: 'Check-out must be after check-in',
  });

export type InquiryCreate = z.infer<typeof InquiryCreateSchema>;
