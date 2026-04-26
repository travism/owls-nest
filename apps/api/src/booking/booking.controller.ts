// Admin endpoints for managing bookings.
// /admin/bookings list/detail + /admin/bookings/:id/approve.
// Conversion from Inquiry stays in InquiryController; that handler now
// delegates to BookingService.convertInquiry under the hood.

import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { AdminSessionGuard, type RequestWithAdmin } from '../auth/admin-session.guard';
import { AuditService } from '../auth/audit.service';
import { z } from 'zod';
import { BookingService, type BookingStatus } from './booking.service';

const StatusFilterSchema = z.object({
  status: z
    .enum([
      'inquiry',
      'pending_approval',
      'approved',
      'confirmed',
      'cancelled',
      'completed',
    ])
    .optional(),
});

function ipOf(req: Request): string | null {
  return (req.ip ?? req.socket?.remoteAddress) ?? null;
}
function uaOf(req: Request): string | null {
  return req.get('user-agent') ?? null;
}

@Controller('api/v1/admin/bookings')
@UseGuards(AdminSessionGuard)
export class AdminBookingController {
  constructor(
    private readonly bookings: BookingService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(StatusFilterSchema))
    q: z.infer<typeof StatusFilterSchema>,
  ) {
    return this.bookings.list({ status: q.status as BookingStatus | undefined });
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookings.getById(id);
  }

  @Post(':id/approve')
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAdmin,
  ) {
    const before = await this.bookings.getById(id);
    const result = await this.bookings.approve(id);
    await this.audit.log({
      action: 'booking.approve',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'booking',
      targetId: id,
      before,
      after: result.booking,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return result;
  }
}
