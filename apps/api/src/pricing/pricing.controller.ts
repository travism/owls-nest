import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { PricingQuoteRequestSchema } from '@owlsnest/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { PricingService } from './pricing.service';

type QuoteQuery = z.infer<typeof PricingQuoteRequestSchema>;

@Controller('api/v1/pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /**
   * Public endpoint — used by the guest booking calendar.
   * No auth required; abuse mitigated by the global rate limiter.
   */
  @Get('quote')
  @UsePipes(new ZodValidationPipe(PricingQuoteRequestSchema))
  async quote(@Query() q: QuoteQuery) {
    return this.pricing.getQuote(new Date(q.checkIn), new Date(q.checkOut));
  }
}
