import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Walk up from this file's directory looking for a `.env` file. Stops at the
 * filesystem root. Used in dev so `pnpm dev` "just works" without each
 * contributor having to remember to `source ../../.env` first.
 *
 * In production the API runs inside a Docker container where Compose's
 * `env_file` directive has already populated process.env — no .env file
 * is shipped, so this lookup finds nothing and is a no-op.
 */
function findEnvFile(): string | null {
  let dir = __dirname;
  for (let depth = 0; depth < 10; depth++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

if (process.env.NODE_ENV !== 'production') {
  const envFile = findEnvFile();
  if (envFile) dotenv.config({ path: envFile });
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // Secrets — required in production, optional in dev so the API
  // can boot before all integrations are wired
  ADMIN_TOTP_KEY: z.string().min(32).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  CLEANER_TOKEN_SECRET: z.string().min(32).optional(),

  // Integrations
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  MAILERSEND_API_KEY: z.string().optional(),
  MAILERSEND_FROM_EMAIL: z.string().email().optional(),

  // Email adapter selection (M9 / D-021)
  EMAIL_PROVIDER: z.enum(['mailhog', 'mailersend', 'fake']).optional(),
  EMAIL_FROM: z.string().optional(),
  MAILHOG_HOST: z.string().optional(),
  MAILHOG_PORT: z.coerce.number().int().positive().optional(),
  ADMIN_NOTIFICATION_EMAIL: z.string().email().optional(),
  PRICELABS_API_KEY: z.string().optional(),
  PRICELABS_LISTING_ID: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  // Treat empty strings as missing — `.env` files commonly have placeholder
  // empty values like `STRIPE_SECRET_KEY=`, which would otherwise fail
  // .optional() schemas with min length / email constraints.
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    cleaned[key] = value === '' ? undefined : value;
  }
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  // Production secret enforcement
  if (parsed.data.NODE_ENV === 'production') {
    const required: Array<keyof Env> = [
      'ADMIN_TOTP_KEY',
      'SESSION_SECRET',
      'CLEANER_TOKEN_SECRET',
    ];
    const missing = required.filter((k) => !parsed.data[k]);
    if (missing.length > 0) {
      console.error(`Production env missing secrets: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  return parsed.data;
}
