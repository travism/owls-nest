import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@owlsnest/prisma';
import type { PropertyUpdate } from '@owlsnest/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PropertyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * V1: there is exactly one property. Returns the only row.
   */
  async getProperty() {
    const p = await this.prisma.property.findFirst();
    if (!p) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Property not configured.',
      });
    }
    return this.serialize(p);
  }

  async updateProperty(update: PropertyUpdate) {
    const existing = await this.prisma.property.findFirst({ select: { id: true } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Property not configured.',
      });
    }
    const data: Prisma.PropertyUpdateInput = {};
    if (update.name !== undefined) data.name = update.name;
    if (update.addressLine1 !== undefined) data.addressLine1 = update.addressLine1;
    if (update.city !== undefined) data.city = update.city;
    if (update.state !== undefined) data.state = update.state;
    if (update.postalCode !== undefined) data.postalCode = update.postalCode;
    if (update.checkInTime !== undefined) data.checkInTime = update.checkInTime;
    if (update.checkOutTime !== undefined) data.checkOutTime = update.checkOutTime;
    if (update.maxGuests !== undefined) data.maxGuests = update.maxGuests;
    if (update.baseNightlyRate !== undefined) data.baseNightlyRate = update.baseNightlyRate;
    if (update.cleaningFee !== undefined) data.cleaningFee = update.cleaningFee;
    if (update.minStay !== undefined) data.minStay = update.minStay;
    if (update.cancellationPolicy !== undefined) {
      data.cancellationPolicy = update.cancellationPolicy as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.property.update({
      where: { id: existing.id },
      data,
    });
    return this.serialize(updated);
  }

  /**
   * Convert Prisma's Decimal columns to plain numbers for JSON output.
   * Centralized so the controller doesn't have to.
   */
  private serialize(p: any) {
    return {
      id: p.id,
      name: p.name,
      addressLine1: p.addressLine1,
      city: p.city,
      state: p.state,
      postalCode: p.postalCode,
      checkInTime: p.checkInTime,
      checkOutTime: p.checkOutTime,
      maxGuests: p.maxGuests,
      baseNightlyRate: Number(p.baseNightlyRate),
      cleaningFee: Number(p.cleaningFee),
      minStay: p.minStay,
      cancellationPolicy: p.cancellationPolicy,
    };
  }
}
