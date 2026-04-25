import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditAction =
  // Auth
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.login.locked'
  | 'auth.totp.success'
  | 'auth.totp.failed'
  | 'auth.recovery.success'
  | 'auth.recovery.failed'
  | 'auth.logout'
  | 'auth.setup.password'
  | 'auth.setup.totp.enrolled'
  // Property
  | 'property.update'
  // Blocked dates
  | 'blocked_date.create'
  | 'blocked_date.delete'
  // Booking lifecycle (forward-looking; used in M7/M8)
  | 'booking.approve'
  | 'booking.decline'
  | 'booking.cancel'
  | 'booking.refund'
  | 'booking.modify';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    action: AuditAction;
    adminUserId?: string | null;
    targetType?: string;
    targetId?: string;
    before?: unknown;
    after?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.prisma.auditLogEntry.create({
      data: {
        action: params.action,
        adminUserId: params.adminUserId ?? null,
        targetType: params.targetType,
        targetId: params.targetId,
        before: params.before === undefined ? undefined : (params.before as object),
        after: params.after === undefined ? undefined : (params.after as object),
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    });
  }
}
