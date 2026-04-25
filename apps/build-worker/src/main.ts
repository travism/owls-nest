// build-worker — consumes the `rebuild-site` BullMQ queue and runs `astro build`,
// then atomically swaps the web container's mounted dist/ directory.
//
// M1 scope: minimal consumer that logs job receipt; actual astro build invocation
// lands when the publish flow is wired in Phase 3 (M3.1).

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

const logger = pino({
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
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
    // TODO (M3.1): run `astro build` against the content snapshot, swap dist/
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
