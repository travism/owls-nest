import { z } from 'zod';
import { ISODateSchema } from './inquiry.js';

/**
 * Public booking-calendar inputs. Both dates inclusive of `from`,
 * exclusive of `to` (matching iCal semantics across the platform).
 */
export const AvailabilityRequestSchema = z
  .object({
    from: ISODateSchema,
    to: ISODateSchema,
  })
  .refine((d) => d.to > d.from, {
    path: ['to'],
    message: 'to must be after from',
  });
export type AvailabilityRequest = z.infer<typeof AvailabilityRequestSchema>;

export const UnavailableRangeSchema = z.object({
  /** Inclusive — first unavailable day. */
  startDate: ISODateSchema,
  /** Exclusive — first available day after this block. */
  endDate: ISODateSchema,
});
export type UnavailableRange = z.infer<typeof UnavailableRangeSchema>;

export const AvailabilityResponseSchema = z.object({
  /** Echo of the queried window so the client can sanity-check. */
  from: ISODateSchema,
  to: ISODateSchema,
  /**
   * Date ranges within [from, to) that cannot be booked. Sources combined:
   * direct bookings (active statuses), manual blocks, OTA-imported blocks.
   * Ranges are not necessarily merged — clients should treat each as opaque.
   */
  unavailable: z.array(UnavailableRangeSchema),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;
