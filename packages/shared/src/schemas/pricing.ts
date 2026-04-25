import { z } from 'zod';
import { ISODateSchema } from './inquiry.js';

export const PricingQuoteRequestSchema = z
  .object({
    checkIn: ISODateSchema,
    checkOut: ISODateSchema,
    numGuests: z.coerce.number().int().min(1).max(8).default(2),
  })
  .refine((d) => d.checkOut > d.checkIn, {
    path: ['checkOut'],
    message: 'Check-out must be after check-in',
  });

export type PricingQuoteRequest = z.infer<typeof PricingQuoteRequestSchema>;

export const PricingTaxLineSchema = z.object({
  label: z.string(),
  rate: z.number(),
  amount: z.number(),
});

export const PricingQuoteResponseSchema = z.object({
  nightlyRate: z.number(),
  numberOfNights: z.number(),
  subtotal: z.number(),
  taxes: z.object({
    stateTlt: PricingTaxLineSchema,
    cityTlt: PricingTaxLineSchema,
    totalTax: z.number(),
  }),
  total: z.number(),
});

export type PricingQuoteResponse = z.infer<typeof PricingQuoteResponseSchema>;
