import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AdminSessionGuard, type RequestWithAdmin } from './admin-session.guard';
import { ZodValidationPipe } from './zod-validation.pipe';
import {
  LoginSchema,
  RecoverySchema,
  SetupPasswordSchema,
  SetupVerifySchema,
  TotpSchema,
} from './dto/auth.dto';
import type { z } from 'zod';

type SetupPasswordDto = z.infer<typeof SetupPasswordSchema>;
type SetupVerifyDto = z.infer<typeof SetupVerifySchema>;
type LoginDto = z.infer<typeof LoginSchema>;
type TotpDto = z.infer<typeof TotpSchema>;
type RecoveryDto = z.infer<typeof RecoverySchema>;

function ipOf(req: Request): string | null {
  return (req.ip ?? req.socket?.remoteAddress) ?? null;
}
function uaOf(req: Request): string | null {
  return req.get('user-agent') ?? null;
}

@Controller('api/v1/auth/admin')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ----- Setup (one-time) -----

  @Post('setup')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(SetupPasswordSchema))
  async setup(@Body() body: SetupPasswordDto, @Req() req: Request) {
    return this.auth.setupPassword({
      email: body.email,
      password: body.password,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
  }

  @Post('setup/verify')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(SetupVerifySchema))
  async setupVerify(@Body() body: SetupVerifyDto, @Req() req: Request) {
    return this.auth.setupVerify({
      setupToken: body.setupToken,
      totpCode: body.totpCode,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
  }

  // ----- Login -----

  @Post('login')
  @HttpCode(200)
  // Stricter rate limit on login per arch §12.3 / CO-11. The lockout
  // service is the per-account safety net; this is the per-IP one.
  @Throttle({
    default: {
      limit: 5 * (process.env.NODE_ENV === 'test' ? 1000 : 1),
      ttl: 60_000,
    },
  })
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const result = await this.auth.login({
      email: body.email,
      password: body.password,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    return { challenge: 'totp', challengeToken: result.challengeToken };
  }

  @Post('totp')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(TotpSchema))
  async totp(@Body() body: TotpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.verifyTotp({
      challengeToken: body.challengeToken,
      code: body.code,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.adminUser = user;
    return { user };
  }

  @Post('recovery')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(RecoverySchema))
  async recovery(@Body() body: RecoveryDto, @Req() req: Request) {
    const user = await this.auth.verifyRecoveryCode({
      challengeToken: body.challengeToken,
      code: body.code,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    req.session.adminUser = user;
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    const adminUserId = req.session?.adminUser?.id ?? null;
    await this.auth.logout({
      adminUserId,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    return { ok: true };
  }

  // ----- Session check -----

  @Get('whoami')
  @UseGuards(AdminSessionGuard)
  whoami(@Req() req: RequestWithAdmin) {
    return { user: req.adminUser };
  }
}
