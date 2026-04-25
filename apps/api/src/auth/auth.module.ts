import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { TotpService } from './totp.service';
import { LockoutService } from './lockout.service';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TotpService, LockoutService, AuditService],
  exports: [AuthService, PasswordService, AuditService],
})
export class AuthModule {}
