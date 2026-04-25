import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TotpService } from './totp.service';
import { LockoutService } from './lockout.service';
import { AuditService } from './audit.service';

export interface AdminSessionUser {
  id: string;
  email: string;
}

export interface ChallengeRecord {
  adminUserId: string;
  step: 'totp';
  expiresAt: number;
}

@Injectable()
export class AuthService {
  // In-memory short-lived challenge store. 5 minute TTL is plenty for the
  // user to enter a TOTP code. Survives a single API process; if the API
  // restarts mid-flow, the user simply re-enters the password. No need
  // for Redis here — these are very short-lived.
  private readonly challenges = new Map<string, ChallengeRecord>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly lockout: LockoutService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------
  // First-time setup
  // ---------------------------------------------------------------

  /**
   * One-time setup: set the admin's password and generate a TOTP secret.
   * Only works if the admin has the placeholder password. Returns the
   * otpauth URL + QR data URL to enroll, and a setup token to confirm.
   */
  async setupPassword(params: {
    email: string;
    password: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ otpauthUrl: string; qrDataUrl: string; setupToken: string }> {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: params.email },
    });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    if (user.totpEnrolledAt) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Setup already complete; use /login.',
      });
    }
    if (user.passwordHash !== 'PLACEHOLDER-MUST-RESET') {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Password already set; use /login.',
      });
    }
    if (params.password.length < 12) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Password must be at least 12 characters.',
      });
    }

    const hash = await this.passwords.hash(params.password);
    const secret = this.totp.generateSecret();
    const encrypted = this.totp.encrypt(secret);

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: hash, totpSecretEncrypted: encrypted },
    });

    await this.audit.log({
      action: 'auth.setup.password',
      adminUserId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    const otpauthUrl = this.totp.otpauthUrl(user.email, secret);
    const qrDataUrl = await this.totp.qrDataUrl(otpauthUrl);
    const setupToken = this.issueChallenge(user.id);
    return { otpauthUrl, qrDataUrl, setupToken };
  }

  /**
   * Confirm TOTP enrollment: user enters a code from their authenticator
   * app. On success, generate recovery codes and mark enrollment complete.
   */
  async setupVerify(params: {
    setupToken: string;
    totpCode: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ recoveryCodes: string[] }> {
    const challenge = this.consumeChallenge(params.setupToken);
    if (!challenge) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }
    const user = await this.prisma.adminUser.findUnique({
      where: { id: challenge.adminUserId },
    });
    if (!user || !user.totpSecretEncrypted) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }
    const secret = this.totp.decrypt(user.totpSecretEncrypted);
    if (!(await this.totp.verify(secret, params.totpCode))) {
      throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: 'Invalid TOTP code.' });
    }

    const recoveryCodes = this.totp.generateRecoveryCodes(10);
    const hashedCodes = await Promise.all(recoveryCodes.map((c) => this.passwords.hash(c)));

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: {
        totpEnrolledAt: new Date(),
        recoveryCodesHashed: hashedCodes,
      },
    });

    await this.audit.log({
      action: 'auth.setup.totp.enrolled',
      adminUserId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return { recoveryCodes };
  }

  // ---------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------

  async login(params: {
    email: string;
    password: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ challengeToken: string }> {
    const user = await this.prisma.adminUser.findUnique({ where: { email: params.email } });
    // Constant-time-ish: always compute a hash even if user doesn't exist
    if (!user) {
      await this.passwords.verify('$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', params.password);
      await this.audit.log({
        action: 'auth.login.failed',
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }

    if (await this.lockout.isLocked(user.id)) {
      await this.audit.log({
        action: 'auth.login.locked',
        adminUserId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Account is temporarily locked due to too many failed attempts.',
      });
    }

    if (!user.totpEnrolledAt) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Account setup incomplete; use /setup.',
      });
    }

    const ok = await this.passwords.verify(user.passwordHash, params.password);
    if (!ok) {
      const result = await this.lockout.recordFailure(user.id);
      await this.audit.log({
        action: result.locked ? 'auth.login.locked' : 'auth.login.failed',
        adminUserId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        after: { remaining: result.remaining },
      });
      if (result.locked) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Account locked.' });
      }
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }

    const challengeToken = this.issueChallenge(user.id);
    return { challengeToken };
  }

  async verifyTotp(params: {
    challengeToken: string;
    code: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<AdminSessionUser> {
    const challenge = this.consumeChallenge(params.challengeToken);
    if (!challenge) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }
    const user = await this.prisma.adminUser.findUnique({ where: { id: challenge.adminUserId } });
    if (!user || !user.totpSecretEncrypted) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }
    const secret = this.totp.decrypt(user.totpSecretEncrypted);
    if (!(await this.totp.verify(secret, params.code))) {
      const result = await this.lockout.recordFailure(user.id);
      await this.audit.log({
        action: result.locked ? 'auth.login.locked' : 'auth.totp.failed',
        adminUserId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: 'Invalid TOTP code.' });
    }

    await this.lockout.recordSuccess(user.id);
    await this.audit.log({
      action: 'auth.totp.success',
      adminUserId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    await this.audit.log({
      action: 'auth.login.success',
      adminUserId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return { id: user.id, email: user.email };
  }

  async verifyRecoveryCode(params: {
    challengeToken: string;
    code: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<AdminSessionUser> {
    const challenge = this.consumeChallenge(params.challengeToken);
    if (!challenge) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    }
    const user = await this.prisma.adminUser.findUnique({ where: { id: challenge.adminUserId } });
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });

    // Linear scan since there are at most 10 codes; verify is intentionally
    // slow (Argon2id) so we accept the cost.
    let matchedIndex = -1;
    for (let i = 0; i < user.recoveryCodesHashed.length; i++) {
      const hash = user.recoveryCodesHashed[i];
      if (!hash) continue;
      if (await this.passwords.verify(hash, params.code)) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex < 0) {
      const result = await this.lockout.recordFailure(user.id);
      await this.audit.log({
        action: result.locked ? 'auth.login.locked' : 'auth.recovery.failed',
        adminUserId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Invalid recovery code.' });
    }

    // Burn the used code
    const remaining = user.recoveryCodesHashed.filter((_, i) => i !== matchedIndex);
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { recoveryCodesHashed: remaining },
    });

    await this.lockout.recordSuccess(user.id);
    await this.audit.log({
      action: 'auth.recovery.success',
      adminUserId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      after: { codesRemaining: remaining.length },
    });
    await this.audit.log({
      action: 'auth.login.success',
      adminUserId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return { id: user.id, email: user.email };
  }

  async logout(params: {
    adminUserId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<void> {
    if (params.adminUserId) {
      await this.audit.log({
        action: 'auth.logout',
        adminUserId: params.adminUserId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
    }
  }

  async getById(id: string): Promise<AdminSessionUser | null> {
    const u = await this.prisma.adminUser.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    return u;
  }

  // ---------------------------------------------------------------
  // Challenge tokens (in-memory, 5-min TTL)
  // ---------------------------------------------------------------

  private issueChallenge(adminUserId: string): string {
    this.gcChallenges();
    const token = crypto.randomBytes(32).toString('base64url');
    this.challenges.set(token, {
      adminUserId,
      step: 'totp',
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return token;
  }

  private consumeChallenge(token: string): ChallengeRecord | null {
    this.gcChallenges();
    const c = this.challenges.get(token);
    if (!c) return null;
    if (c.expiresAt < Date.now()) {
      this.challenges.delete(token);
      return null;
    }
    this.challenges.delete(token);
    return c;
  }

  private gcChallenges(): void {
    const now = Date.now();
    for (const [token, rec] of this.challenges) {
      if (rec.expiresAt < now) this.challenges.delete(token);
    }
  }
}
