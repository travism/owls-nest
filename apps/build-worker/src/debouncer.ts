// 30-second build debouncer (per D-005). Multiple `rebuild-site` jobs that
// arrive inside the cooldown collapse to a single build using the latest
// payload. The build runs at the end of the cooldown window with whatever
// payload was most recently submitted.
//
// Pure logic — `runner` is the function that actually performs the build,
// passed in so this module is unit-testable without invoking `astro build`.

export interface DebouncerOptions {
  cooldownMs: number;
  runner: (payload: unknown) => Promise<void>;
}

export class BuildDebouncer {
  private latestPayload: unknown = null;
  private pending = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: DebouncerOptions) {}

  /**
   * Submit a build request. Returns synchronously after recording the latest
   * payload + arming the cooldown timer. Use `drain()` to await completion.
   */
  submit(payload: unknown): void {
    this.latestPayload = payload;
    this.pending = true;
    if (this.timer) return; // existing window will pick up the new payload
    this.timer = setTimeout(() => {
      this.timer = null;
      const payloadAtFire = this.latestPayload;
      this.pending = false;
      this.running = true;
      this.opts
        .runner(payloadAtFire)
        .catch(() => {
          // Caller's responsibility to log; debouncer just orchestrates.
        })
        .finally(() => {
          this.running = false;
        });
    }, this.opts.cooldownMs);
  }

  /** Wait for any in-flight or pending build to complete. */
  async drain(): Promise<void> {
    while (this.timer || this.running) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  isPending(): boolean {
    return this.pending;
  }
}
