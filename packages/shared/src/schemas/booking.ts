import { z } from 'zod';
import { ISODateSchema } from './inquiry.js';

export const BookingStatusSchema = z.enum([
  'inquiry',
  'pending_approval',
  'approved',
  'confirmed',
  'cancelled',
  'completed',
]);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingSourceSchema = z.enum([
  'direct',
  'airbnb',
  'vrbo',
  'booking_com',
  'google',
]);
export type BookingSource = z.infer<typeof BookingSourceSchema>;

export const BookingRequestSchema = z
  .object({
    checkIn: ISODateSchema,
    checkOut: ISODateSchema,
    numGuests: z.number().int().min(1).max(8),
    message: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.checkOut > d.checkIn, {
    path: ['checkOut'],
    message: 'Check-out must be after check-in',
  });

export type BookingRequest = z.infer<typeof BookingRequestSchema>;
