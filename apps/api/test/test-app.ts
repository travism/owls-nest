// Helper: builds a NestJS test app with the same middleware stack as main.ts
// but pointed at the test database. Returns the app + an HTTP agent that
// keeps cookies between requests (sessions + CSRF).

import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { RedisService } from '../src/redis/redis.service';
import { buildCsrf } from '../src/auth/csrf';

export interface TestApp {
  app: INestApplication;
  base: string;
}

export async function createTestApp(): Promise<TestApp> {
  // Force the test DB and a sane secret before anything imports config
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    'postgresql://owlsnest:owlsnest@localhost:5432/owlsnest_test';
  process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
  process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';
  process.env.SESSION_SECRET =
    'test-session-secret-32-chars-minimum-aaaaaa';
  process.env.ADMIN_TOTP_KEY =
    'test-totp-key-32-chars-minimum-aaaaaaaaaa';
  process.env.CLEANER_TOKEN_SECRET =
    'test-cleaner-secret-32-chars-minimum-aaaa';

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  // Mirror the production middleware stack (minus prod-only bits)
  app.use(cookieParser());

  const redisService = app.get(RedisService);
  await redisService.connect(
    process.env.REDIS_HOST!,
    Number(process.env.REDIS_PORT!),
  );

  const sessionSecret = process.env.SESSION_SECRET!;
  app.use(
    session({
      name: 'admin_session',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );

  const csrf = buildCsrf(sessionSecret, false);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && req.path === '/api/v1/auth/csrf-token') {
      (req.session as any).csrfPrimed = true;
      const token = csrf.generateCsrfToken(req, res);
      res.json({ token });
      return;
    }
    next();
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isProtected = req.path.startsWith('/api/v1/auth/admin');
    const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (!isProtected || safe) return next();
    csrf.doubleCsrfProtection(req, res, next);
  });

  await app.init();

  const server = app.getHttpServer();
  // For supertest we just need the server; supertest handles the rest.
  // We expose `base` for documentation; tests pass `server` to supertest directly.
  return { app, base: '' };
}
