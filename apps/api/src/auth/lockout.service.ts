import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class LockoutService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns true if the account is currently locked.
   */
  async isLocked(adminUserId: string): Promise<boolean> {
    const u = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { lockedUntil: true },
    });
    if (!u?.lockedUntil) return false;
    return u.lockedUntil > new Date();
  }

  /**
   * Increment failed attempts; lock if threshold reached.
   */
  async recordFailure(adminUserId: string): Promise<{ locked: boolean; remaining: number }> {
    const u = await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    if (u.failedAttempts >= MAX_ATTEMPTS) {
      const until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      await this.prisma.adminUser.update({
        where: { id: adminUserId },
        data: { lockedUntil: until, failedAttempts: 0 },
      });
      return { locked: true, remaining: 0 };
    }
    return { locked: false, remaining: MAX_ATTEMPTS - u.failedAttempts };
  }

  /**
   * Reset on successful login.
   */
  async recordSuccess(adminUserId: string): Promise<void> {
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }
}
