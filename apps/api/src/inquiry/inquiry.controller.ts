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
import { InquiryCreateSchema } from '@owlsnest/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { AdminSessionGuard, type RequestWithAdmin } from '../auth/admin-session.guard';
import { AuditService } from '../auth/audit.service';
import { InquiryService } from './inquiry.service';

const StatusFilterSchema = z.object({
  status: z.enum(['new', 'responded', 'converted', 'closed']).optional(),
});

const TransitionBodySchema = z.object({
  status: z.enum(['responded', 'closed']),
});

function ipOf(req: Request): string | null {
  return (req.ip ?? req.socket?.remoteAddress) ?? null;
}
function uaOf(req: Request): string | null {
  return req.get('user-agent') ?? null;
}

// Public — guest submission. Anyone can POST.
@Controller('api/v1/inquiries')
export class PublicInquiryController {
  constructor(private readonly inquiry: InquiryService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(InquiryCreateSchema))
    body: z.infer<typeof InquiryCreateSchema>,
  ) {
    const created = await this.inquiry.create(body);
    // Don't echo the entire row to a public caller — just enough to
    // confirm receipt.
    return { id: created.id, status: created.status };
  }
}

// Admin-only — list, view, transition, convert. Mounted under a separate
// prefix so the guards apply only here.
@Controller('api/v1/admin/inquiries')
@UseGuards(AdminSessionGuard)
export class AdminInquiryController {
  constructor(
    private readonly inquiry: InquiryService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(StatusFilterSchema))
    q: z.infer<typeof StatusFilterSchema>,
  ) {
    return this.inquiry.list({ status: q.status });
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.inquiry.getById(id);
  }

  @Post(':id/transition')
  async transition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(TransitionBodySchema))
    body: z.infer<typeof TransitionBodySchema>,
    @Req() req: RequestWithAdmin,
  ) {
    const before = await this.inquiry.getById(id);
    const after = await this.inquiry.transition(id, body.status);
    await this.audit.log({
      action: 'inquiry.transition',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'inquiry',
      targetId: id,
      before,
      after,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return after;
  }

  @Post(':id/convert')
  async convert(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: RequestWithAdmin,
  ) {
    const before = await this.inquiry.getById(id);
    const after = await this.inquiry.convert(id);
    await this.audit.log({
      action: 'inquiry.convert',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'inquiry',
      targetId: id,
      before,
      after,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return after;
  }
}
