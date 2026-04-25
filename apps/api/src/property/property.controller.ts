import { Body, Controller, Get, Patch, Req, UseGuards, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import { PropertyUpdateSchema } from '@owlsnest/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { AdminSessionGuard, type RequestWithAdmin } from '../auth/admin-session.guard';
import { AuditService } from '../auth/audit.service';
import { PropertyService } from './property.service';

type UpdateBody = z.infer<typeof PropertyUpdateSchema>;

function ipOf(req: Request): string | null {
  return (req.ip ?? req.socket?.remoteAddress) ?? null;
}
function uaOf(req: Request): string | null {
  return req.get('user-agent') ?? null;
}

@Controller('api/v1/property')
export class PropertyController {
  constructor(
    private readonly property: PropertyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public: guest site uses this for build-time property metadata
   * (check-in time, max guests, cancellation policy display).
   */
  @Get()
  async get() {
    return this.property.getProperty();
  }

  /**
   * Admin: updates property settings. Audit-logged with before/after.
   */
  @Patch()
  @UseGuards(AdminSessionGuard)
  @UsePipes(new ZodValidationPipe(PropertyUpdateSchema))
  async update(@Body() body: UpdateBody, @Req() req: RequestWithAdmin) {
    const before = await this.property.getProperty();
    const after = await this.property.updateProperty(body);
    await this.audit.log({
      action: 'property.update',
      adminUserId: req.adminUser?.id ?? null,
      targetType: 'property',
      targetId: after.id,
      before,
      after,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return after;
  }
}
