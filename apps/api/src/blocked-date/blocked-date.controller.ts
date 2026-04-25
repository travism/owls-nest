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
import type { Request } from 'express';
import { BlockedDateCreateSchema } from '@owlsnest/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { AdminSessionGuard, type RequestWithAdmin } from '../auth/admin-session.guard';
import { AuditService } from '../auth/audit.service';
import { BlockedDateService } from './blocked-date.service';

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
