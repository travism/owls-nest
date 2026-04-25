import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminSessionUser } from './auth.service';

declare module 'express-session' {
  interface SessionData {
    adminUser?: AdminSessionUser;
  }
}

export interface RequestWithAdmin extends Request {
  adminUser?: AdminSessionUser;
}

@Injectable()
export class AdminSessionGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RequestWithAdmin>();
    const u = req.session?.adminUser;
    if (!u) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }
    req.adminUser = u;
    return true;
  }
}
