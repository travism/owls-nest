import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { BlockedDateCreate } from '@owlsnest/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlockedDateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all blocks across all sources (manual, maintenance, OTA-imported).
   * Optionally filter by reason. Used by both the admin calendar view and
   * the public availability endpoint.
   */
  async list(opts?: { from?: Date; to?: Date; reason?: string }) {
    const rows = await this.prisma.blockedDate.findMany({
      where: {
        ...(opts?.reason ? { reason: opts.reason } : {}),
        ...(opts?.from || opts?.to
          ? {
              startDate: opts.to ? { lt: opts.to } : undefined,
              endDate: opts.from ? { gt: opts.from } : undefined,
            }
          : {}),
      },
      orderBy: { startDate: 'asc' },
    });
    return rows.map((r) => this.serialize(r));
  }

  async create(input: BlockedDateCreate) {
    const property = await this.prisma.property.findFirst({ select: { id: true } });
    if (!property) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Property not configured.',
      });
    }
    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'End date must be after start date.',
      });
    }
    const created = await this.prisma.blockedDate.create({
      data: {
        propertyId: property.id,
        startDate,
        endDate,
        reason: input.reason,
        sourceSummary: input.note ?? null,
      },
    });
    return this.serialize(created);
  }

  async delete(id: string) {
    const existing = await this.prisma.blockedDate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Block not found.' });
    }
    if (existing.reason === 'ota_booking') {
      // Don't let admins delete iCal-imported blocks; they'll just reappear
      // on the next sync. They should manage those on the OTA platform itself.
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'OTA-imported blocks cannot be deleted manually. Cancel on the source platform.',
      });
    }
    await this.prisma.blockedDate.delete({ where: { id } });
    return existing;
  }

  private serialize(b: any) {
    return {
      id: b.id,
      startDate: toISODate(b.startDate),
      endDate: toISODate(b.endDate),
      reason: b.reason,
      sourcePlatform: b.sourcePlatform ?? null,
      sourceSummary: b.sourceSummary ?? null,
    };
  }
}

function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
