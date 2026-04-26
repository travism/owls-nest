// Admin endpoints for managing bookings.
// /admin/bookings list/detail + lifecycle actions:
//   - approve / decline (M7 + M8)
//   - cancel (M8) — auto-refunds per cancellation tier
//   - modify-dates (M8) — re-quotes pricing, suggests extension or refunds
//   - charges (M8) — ad-hoc payment requests
//   - charges/:chargeId/refund (M8) — partial/full refunds
// All actions write an AuditLogEntry with before/after.

import {
  Body,
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
import { BookingService, type BookingStatus, type AdHocChargeKind } from './booking.service';

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

const DeclineBodySchema = z.object({
  reason: z.string().max(2000).optional(),
});
const CancelBodySchema = z.object({
  reason: z.string().max(2000).optional(),
});
const ModifyDatesBodySchema = z.object({
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const AdHocChargeBodySchema = z.object({
  kind: z.enum(['extension', 'damage', 'incidental']),
  amount: z.number().positive().max(50000),
  description: z.string().min(1).max(500),
});
const RefundBodySchema = z.object({
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
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

  @Post(':id/decline')
  async decline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(DeclineBodySchema))
    body: z.infer<typeof DeclineBodySchema>,
    @Req() req: RequestWithAdmin,
  ) {
    const before = await this.bookings.getById(id);
    const after = await this.bookings.decline(id, { reason: body.reason });
    await this.audit.log({
      action: 'booking.decline',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'booking',
      targetId: id,
      before,
      after,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return after;
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(CancelBodySchema))
    body: z.infer<typeof CancelBodySchema>,
    @Req() req: RequestWithAdmin,
  ) {
    const before = await this.bookings.getById(id);
    const after = await this.bookings.cancel(id, { reason: body.reason });
    await this.audit.log({
      action: 'booking.cancel',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'booking',
      targetId: id,
      before,
      after,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return after;
  }

  @Post(':id/modify-dates')
  async modifyDates(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ModifyDatesBodySchema))
    body: z.infer<typeof ModifyDatesBodySchema>,
    @Req() req: RequestWithAdmin,
  ) {
    const before = await this.bookings.getById(id);
    const result = await this.bookings.modifyDates(id, body);
    await this.audit.log({
      action: 'booking.modify_dates',
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

  @Post(':id/charges')
  async createCharge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AdHocChargeBodySchema))
    body: z.infer<typeof AdHocChargeBodySchema>,
    @Req() req: RequestWithAdmin,
  ) {
    const before = await this.bookings.getById(id);
    const result = await this.bookings.createAdHocCharge(id, {
      kind: body.kind as AdHocChargeKind,
      amount: body.amount,
      description: body.description,
    });
    await this.audit.log({
      action: 'booking.ad_hoc_charge',
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

  @Post('charges/:chargeId/refund')
  async refundCharge(
    @Param('chargeId', new ParseUUIDPipe()) chargeId: string,
    @Body(new ZodValidationPipe(RefundBodySchema))
    body: z.infer<typeof RefundBodySchema>,
    @Req() req: RequestWithAdmin,
  ) {
    const result = await this.bookings.refundCharge(chargeId, {
      amount: body.amount,
      reason: body.reason,
    });
    await this.audit.log({
      action: 'booking.refund_charge',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'booking_charge',
      targetId: chargeId,
      before: null,
      after: result.booking,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return result;
  }
}
