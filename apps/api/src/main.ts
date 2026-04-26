import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Logger } from '@nestjs/common';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response, type NextFunction } from 'express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { RedisService } from './redis/redis.service';
import { buildCsrf } from './auth/csrf';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap() {
  const env = loadEnv();
  const log = new Logger('bootstrap');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.useGlobalFilters(new ApiExceptionFilter());

  const isProd = env.NODE_ENV === 'production';

  app.enableCors({
    origin: isProd
      ? ['https://owlsnest.com', 'https://www.owlsnest.com', 'https://admin.owlsnest.com']
      : ['http://localhost:4321', 'http://localhost:5173'],
    credentials: true,
    exposedHeaders: ['x-csrf-token'],
  });

  if (isProd) (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);

  // Stripe webhook needs the raw request body for signature verification.
  // Mount express.raw() FIRST so the global JSON parser (later in the
  // pipeline) doesn't consume the body. Stash the buffer on req.rawBody
  // so the controller can pass it to constructWebhookEvent.
  app.use(
    '/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req: Request, _res: Response, next: NextFunction) => {
      (req as any).rawBody = req.body;
      next();
    },
  );

  app.use(cookieParser());

  // ---- Session ----
  const redisService = app.get(RedisService);
  await redisService.connect(env.REDIS_HOST, env.REDIS_PORT);

  const sessionSecret = env.SESSION_SECRET ?? 'dev-only-session-secret-please-rotate-now';
  if (!env.SESSION_SECRET && !isProd) {
    log.warn('SESSION_SECRET not set; using insecure dev fallback.');
  }

  const cookieName = isProd ? '__Host-admin-session' : 'admin_session';
  const sessionOptions: session.SessionOptions = {
    name: cookieName,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    },
  };
  if (redisService.client) {
    sessionOptions.store = new RedisStore({ client: redisService.client, prefix: 'sess:' });
    log.log('Session store: Redis');
  } else {
    log.warn(
      'Session store: in-memory MemoryStore (Redis unreachable). OK for dev; not for prod.',
    );
  }
  app.use(session(sessionOptions));

  // ---- CSRF (double-submit) ----
  const csrf = buildCsrf(sessionSecret, isProd);
  // Endpoint to issue a token. Mounted before the global CSRF protection
  // middleware so the SPA can fetch a token without already having one.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && req.path === '/api/v1/auth/csrf-token') {
      // Touch the session so saveUninitialized:false still sends a cookie.
      // Without this, the session isn't persisted and the next request gets
      // a different session.id, breaking the CSRF token's session binding.
      (req.session as any).csrfPrimed = true;
      const token = csrf.generateCsrfToken(req, res);
      res.json({ token });
      return;
    }
    next();
  });
  // Apply CSRF protection to non-GET /api/v1 routes EXCEPT for public
  // endpoints that don't read a session cookie. Without an ambient
  // credential there's nothing for CSRF to protect — and we'd just block
  // legitimate form submits from the public site. CORS + Origin checking
  // is what guards public POSTs.
  //
  // Webhooks live outside /api/v1 (under /webhooks/*) and verify provider
  // signatures instead.
  const PUBLIC_NON_GET_PATHS: RegExp[] = [
    /^\/api\/v1\/inquiries$/, // POST — anonymous inquiry submission (M6)
    // Future: /^\/api\/v1\/bookings$/ when self-serve guest booking lands
    //         alongside magic-link auth (M3.7).
  ];
  app.use((req: Request, res: Response, next: NextFunction) => {
    const protectedPath = req.path.startsWith('/api/v1');
    const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const isPublic = PUBLIC_NON_GET_PATHS.some((re) => re.test(req.path));
    if (!protectedPath || safeMethod || isPublic) return next();
    csrf.doubleCsrfProtection(req, res, next);
  });

  await app.listen(env.PORT);
  log.log(`api listening on :${env.PORT} (${env.NODE_ENV})`);
}

bootstrap();
