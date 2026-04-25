// TaxService — implements per-jurisdiction TLT calculation per
// docs/loging-tax-plan.md §5.2.
//
// Two layers apply to The Owl's Nest:
//   - Oregon State TLT (1.5%, quarterly, retain 5% admin fee)
//   - City of Redmond TLT (9.0%, monthly)
// Stays of 30+ consecutive nights are fully exempt (Oregon law).

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TaxBreakdown {
  subtotal: number;
  stateTltRate: number;
  cityTltRate: number;
  stateTltAmount: number;
  cityTltAmount: number;
  totalTax: number;
  totalWithTax: number;
  stateAdminFeeRetained: number;
  taxExempt: boolean;
}

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate the per-jurisdiction tax breakdown for a stay.
   *
   * @param propertyId    Property whose active jurisdictions apply
   * @param subtotal      Pre-tax total (room rate × nights, with cleaning baked in)
   * @param numberOfNights Stay length — 30+ triggers full exemption
   */
  async calculateTax(
    propertyId: string,
    subtotal: number,
    numberOfNights: number,
  ): Promise<TaxBreakdown> {
    const jurisdictions = await this.prisma.taxJurisdiction.findMany({
      where: { propertyId, effectiveTo: null },
    });
    if (jurisdictions.length === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No active tax jurisdictions for property',
      });
    }

    const state = jurisdictions.find((j) => j.jurisdictionLevel === 'state');
    const city = jurisdictions.find((j) => j.jurisdictionLevel === 'city');

    const stateTltRate = state ? Number(state.taxRate) : 0;
    const cityTltRate = city ? Number(city.taxRate) : 0;
    const stateAdminFeeRate = state?.adminFeeRate ? Number(state.adminFeeRate) : 0;
    const exemptThreshold = state?.exemptThresholdNights ?? city?.exemptThresholdNights ?? 30;

    if (numberOfNights >= exemptThreshold) {
      return {
        subtotal,
        stateTltRate,
        cityTltRate,
        stateTltAmount: 0,
        cityTltAmount: 0,
        totalTax: 0,
        totalWithTax: subtotal,
        stateAdminFeeRetained: 0,
        taxExempt: true,
      };
    }

    const stateTltAmount = roundDown(subtotal * stateTltRate);
    const cityTltAmount = roundDown(subtotal * cityTltRate);
    const totalTax = roundDown(stateTltAmount + cityTltAmount);
    const stateAdminFeeRetained = roundDown(stateTltAmount * stateAdminFeeRate);

    return {
      subtotal,
      stateTltRate,
      cityTltRate,
      stateTltAmount,
      cityTltAmount,
      totalTax,
      totalWithTax: roundDown(subtotal + totalTax),
      stateAdminFeeRetained,
      taxExempt: false,
    };
  }
}

/**
 * Oregon statute: TLT amounts "shall be rounded down to the nearest cent."
 * Using Math.floor on cents avoids floating-point round-up surprises.
 */
function roundDown(amount: number): number {
  return Math.floor(amount * 100 + 1e-9) / 100;
}
