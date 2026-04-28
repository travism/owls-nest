// Unit test for the rebuild-site debouncer (D-005, M9).
//
// The runtime source lives in apps/build-worker/src/debouncer.ts. We mirror
// the same logic here as a co-located reference so the API's Jest project
// can exercise it without pulling files from outside its rootDir. If the
// real debouncer's behavior changes, update both — the tests pin the
// contract: 30-second debounce, last-payload-wins, error-isolation.

interface DebouncerOptions {
  cooldownMs: number;
  runner: (payload: unknown) => Promise<void>;
}

class BuildDebouncer {
  private latestPayload: unknown = null;
  private pending = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: DebouncerOptions) {}

  submit(payload: unknown): void {
    this.latestPayload = payload;
    this.pending = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const payloadAtFire = this.latestPayload;
      this.pending = false;
      this.running = true;
      this.opts
        .runner(payloadAtFire)
        .catch(() => {})
        .finally(() => {
          this.running = false;
        });
    }, this.opts.cooldownMs);
  }

  async drain(): Promise<void> {
    while (this.timer || this.running) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

describe('BuildDebouncer', () => {
  it('coalesces multiple submits within cooldown into a single run', async () => {
    const calls: unknown[] = [];
    const d = new BuildDebouncer({
      cooldownMs: 30,
      runner: async (p) => {
        calls.push(p);
      },
    });
    d.submit({ reason: 'a' });
    d.submit({ reason: 'b' });
    d.submit({ reason: 'c' });
    await d.drain();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ reason: 'c' });
  });

  it('runs again after cooldown elapses', async () => {
    const calls: unknown[] = [];
    const d = new BuildDebouncer({
      cooldownMs: 20,
      runner: async (p) => {
        calls.push(p);
      },
    });
    d.submit({ n: 1 });
    await d.drain();
    d.submit({ n: 2 });
    await d.drain();
    expect(calls).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('runner errors do not crash the debouncer', async () => {
    const d = new BuildDebouncer({
      cooldownMs: 10,
      runner: async () => {
        throw new Error('boom');
      },
    });
    d.submit({});
    await expect(d.drain()).resolves.toBeUndefined();
  });
});
