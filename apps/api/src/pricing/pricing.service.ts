// PricingService — generates quotes for the public booking calendar.
//
// V1 (M3): manual base nightly rate from Property.baseNightlyRate.
// PriceLabs cache + per-date PricingOverride land in Phase 3 (M3.9, M3.10).

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TaxService } from '../tax/tax.service';
import type { PricingQuoteResponse } from '@owlsnest/shared';

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tax: TaxService,
  ) {}

  /**
   * Build a public booking quote.
   *
   * Cleaning fee is baked into the nightly rate guests see (per PRD §4.2)
   * but tracked internally on the booking record for cost accounting.
   */
  async getQuote(checkIn: Date, checkOut: Date): Promise<PricingQuoteResponse> {
    const numberOfNights = nightsBetween(checkIn, checkOut);
    if (numberOfNights < 1) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Check-out must be after check-in.',
      });
    }

    const property = await this.prisma.property.findFirst();
    if (!property) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Property not configured.',
      });
    }

    if (numberOfNights < property.minStay) {
      throw new BadRequestException({
        code: 'MIN_STAY_VIOLATION',
        message: `Minimum stay is ${property.minStay} nights.`,
        details: { required: property.minStay, requested: numberOfNights },
      });
    }

    // Cleaning fee is baked into nightly rate guests see.
    const baseRate = Number(property.baseNightlyRate);
    const cleaningFeePerNight = Number(property.cleaningFee) / numberOfNights;
    const guestNightlyRate = round(baseRate + cleaningFeePerNight);

    const subtotal = round(guestNightlyRate * numberOfNights);

    const tax = await this.tax.calculateTax(property.id, subtotal, numberOfNights);

    return {
      nightlyRate: guestNightlyRate,
      numberOfNights,
      subtotal,
      taxes: {
        stateTlt: {
          label: 'Oregon Lodging Tax',
          rate: tax.stateTltRate,
          amount: tax.stateTltAmount,
        },
        cityTlt: {
          label: 'Redmond Lodging Tax',
          rate: tax.cityTltRate,
          amount: tax.cityTltAmount,
        },
        totalTax: tax.totalTax,
      },
      total: tax.totalWithTax,
    };
  }
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function round(amount: number): number {
  return Math.round(amount * 100) / 100;
}
