// M11: Outbox-health endpoint for the admin SPA.
//
// Surfaces dead-lettered notifications (rows the drain has retried 5 times
// without success) so the operator notices when emails stop going out.
// Dead-lettered = enqueuedAt IS NULL && attempts >= 5 (per outbox-drain.service.ts).
// Pending = enqueuedAt IS NULL && attempts < 5 (still draining or scheduled).

import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSessionGuard } from '../auth/admin-session.guard';

const MAX_ATTEMPTS = 5;
const RECENT_LIMIT = 25;

export interface OutboxHealthResponse {
  deadLettered: number;
  oldestDeadLetterAt: string | null;
  pending: number;
  recent: Array<{
    id: string;
    jobName: string;
    idempotencyKey: string | null;
    attempts: number;
    failureReason: string | null;
    createdAt: string;
    failedAt: string | null;
  }>;
}

@Controller('api/v1/admin/outbox-health')
@UseGuards(AdminSessionGuard)
export class OutboxController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<OutboxHealthResponse> {
    const [deadLettered, pending, recent, oldest] = await Promise.all([
      this.prisma.outbox.count({
        where: { enqueuedAt: null, attempts: { gte: MAX_ATTEMPTS } },
      }),
      this.prisma.outbox.count({
        where: { enqueuedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      }),
      this.prisma.outbox.findMany({
        where: { enqueuedAt: null, attempts: { gte: MAX_ATTEMPTS } },
        orderBy: { failedAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          jobName: true,
          idempotencyKey: true,
          attempts: true,
          failureReason: true,
          createdAt: true,
          failedAt: true,
        },
      }),
      this.prisma.outbox.findFirst({
        where: { enqueuedAt: null, attempts: { gte: MAX_ATTEMPTS } },
        orderBy: { failedAt: 'asc' },
        select: { failedAt: true },
      }),
    ]);

    return {
      deadLettered,
      pending,
      oldestDeadLetterAt: oldest?.failedAt?.toISOString() ?? null,
      recent: recent.map((r) => ({
        id: r.id,
        jobName: r.jobName,
        idempotencyKey: r.idempotencyKey,
        attempts: r.attempts,
        failureReason: r.failureReason,
        createdAt: r.createdAt.toISOString(),
        failedAt: r.failedAt?.toISOString() ?? null,
      })),
    };
  }
}
