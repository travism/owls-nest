import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { BlockedDateCreateSchema } from '@owlsnest/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { AdminSessionGuard, type RequestWithAdmin } from '../auth/admin-session.guard';
import { AuditService } from '../auth/audit.service';
import { BlockedDateService } from './blocked-date.service';

// M11: rate-limit state-changing admin endpoints. 30/60s matches the
// inquiry-transition risk class — defense-in-depth on top of session auth +
// audit log. The TEST_MULTIPLIER bumps this 1000x in tests so other suites
// don't trip it; rate-limit.e2e-spec.ts verifies the real limit.
const ADMIN_WRITE_THROTTLE = {
  default: {
    limit: 30 * (process.env.NODE_ENV === 'test' ? 1000 : 1),
    ttl: 60_000,
  },
};

type CreateBody = z.infer<typeof BlockedDateCreateSchema>;

function ipOf(req: Request): string | null {
  return (req.ip ?? req.socket?.remoteAddress) ?? null;
}
function uaOf(req: Request): string | null {
  return req.get('user-agent') ?? null;
}

@Controller('api/v1/blocked-dates')
@UseGuards(AdminSessionGuard)
export class BlockedDateController {
  constructor(
    private readonly blocks: BlockedDateService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    return this.blocks.list();
  }

  @Post()
  @Throttle(ADMIN_WRITE_THROTTLE)
  @UsePipes(new ZodValidationPipe(BlockedDateCreateSchema))
  async create(@Body() body: CreateBody, @Req() req: RequestWithAdmin) {
    const created = await this.blocks.create(body);
    await this.audit.log({
      action: 'blocked_date.create',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'blocked_date',
      targetId: created.id,
      after: created,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return created;
  }

  @Delete(':id')
  @Throttle(ADMIN_WRITE_THROTTLE)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: RequestWithAdmin) {
    const before = await this.blocks.delete(id);
    await this.audit.log({
      action: 'blocked_date.delete',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'blocked_date',
      targetId: id,
      before,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return { ok: true };
  }
}
