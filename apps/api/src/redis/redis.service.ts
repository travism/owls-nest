import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import IORedis, { type Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  private _client: Redis | null = null;
  private _available = false;

  /**
   * Returns the underlying ioredis client if Redis is reachable, else null.
   * Callers should treat null as "feature unavailable" rather than crashing.
   * Used by session store, BullMQ producers, etc.
   */
  get client(): Redis | null {
    return this._available ? this._client : null;
  }

  get available(): boolean {
    return this._available;
  }

  async connect(host: string, port: number): Promise<void> {
    this._client = new IORedis({
      host,
      port,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    this._client.on('error', (err) => {
      if (this._available) {
        this.log.warn(`Redis error: ${err.message}`);
        this._available = false;
      }
    });

    this._client.on('ready', () => {
      this.log.log(`Redis connected at ${host}:${port}`);
      this._available = true;
    });

    try {
      await this._client.connect();
      await this._client.ping();
      this._available = true;
    } catch (err) {
      this.log.warn(
        `Redis unreachable at ${host}:${port} — features requiring Redis will be disabled. (${(err as Error).message})`,
      );
      this._available = false;
    }
  }

  async onModuleDestroy() {
    if (this._client) {
      try {
        await this._client.quit();
      } catch {
        this._client.disconnect();
      }
    }
  }
}
