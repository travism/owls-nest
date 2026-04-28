// build-worker — consumes the `rebuild-site` BullMQ queue and runs `astro build`,
// then atomically swaps the web container's mounted dist/ directory.
//
// M9 implementation:
//   - Connect to BullMQ rebuild-site queue
//   - Each job runs `astro build` via child_process.spawn against WEB_APP_PATH
//   - Output goes to ${WEB_DIST_PATH}.next/, then atomic rename to WEB_DIST_PATH
//   - 30-second debounce (D-005) — see ./debouncer
//   - Errors rethrow so BullMQ applies its built-in retry/backoff

import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { BuildDebouncer } from './debouncer.js';

const logger = pino({
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
});

const WEB_APP_PATH = process.env.WEB_APP_PATH ?? '/app/apps/web';
const WEB_DIST_PATH = process.env.WEB_DIST_PATH ?? '/web-dist';
const COOLDOWN_MS = Number(process.env.BUILD_DEBOUNCE_MS ?? 30_000);

async function runAstroBuild(_payload: unknown): Promise<void> {
  const stagingDir = `${WEB_DIST_PATH}.next`;
  // Clean any leftover staging dir from a previous failed build.
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'astro', 'build'], {
      cwd: WEB_APP_PATH,
      env: {
        ...process.env,
        // Tell Astro to emit into the staging dir; final swap below.
        ASTRO_OUT_DIR: stagingDir,
      },
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`astro build exited with code ${code}`)),
    );
    child.on('error', (err) => reject(err));
  });

  // Atomic swap: move the old dist out of the way, the new one in, then
  // delete the old. fs.rename is atomic within a single filesystem.
  const archive = `${WEB_DIST_PATH}.prev`;
  let hadOld = false;
  try {
    await stat(WEB_DIST_PATH);
    hadOld = true;
  } catch {
    /* first build — no existing dir */
  }
  if (hadOld) {
    await rm(archive, { recursive: true, force: true });
    await rename(WEB_DIST_PATH, archive);
  }
  await rename(stagingDir, WEB_DIST_PATH);
  if (hadOld) {
    await rm(archive, { recursive: true, force: true }).catch(() => {});
  }
  logger.info({ from: join(WEB_APP_PATH, 'dist'), to: WEB_DIST_PATH }, 'build swapped');
}

const debouncer = new BuildDebouncer({
  cooldownMs: COOLDOWN_MS,
  runner: runAstroBuild,
});

const connection = new IORedis({
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'rebuild-site',
  async (job: Job) => {
    logger.info({ jobId: job.id, name: job.name }, 'rebuild-site job received');
    // Submitting registers the latest payload + arms the cooldown timer.
    // Wait for the build to actually finish so BullMQ records correct status.
    debouncer.submit(job.data);
    await debouncer.drain();
    return { ok: true };
  },
  { connection, concurrency: 1 },
);

worker.on('ready', () => logger.info('build-worker ready'));
worker.on('failed', (job, err) =>
  logger.error({ jobId: job?.id, err: err.message }, 'job failed'),
);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await worker.close();
  await connection.quit();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
