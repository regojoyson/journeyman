/**
 * @file semaphore.ts
 * Promise-based semaphore primitives for limiting concurrent pipeline runs per product.
 *
 * `Semaphore` — classic counting semaphore: callers await `acquire()` and call
 * `release()` when done. Internally queues waiters as resolve callbacks.
 *
 * `SemaphorePool` — named pool keyed by product id. Each product gets its own
 * Semaphore sized from the `limits` map, falling back to `defaultLimit` (Infinity).
 * The server uses this to cap how many flows run in parallel for a single product
 * while allowing other products to proceed unimpeded.
 */

class Semaphore {
  private queue: Array<() => void> = [];
  constructor(private permits: number) {}

  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise<void>(res => this.queue.push(res));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.permits++;
  }
}

/** Per-key semaphore pool. Each key gets its own limit (from `limits` or `defaultLimit`). */
export class SemaphorePool {
  private sems = new Map<string, Semaphore>();

  constructor(
    private readonly limits: Record<string, number>,
    private readonly defaultLimit = Infinity,
  ) {}

  private for(key: string): Semaphore {
    let s = this.sems.get(key);
    if (!s) {
      const limit = this.limits[key] ?? this.defaultLimit;
      s = new Semaphore(limit === Infinity ? Number.MAX_SAFE_INTEGER : limit);
      this.sems.set(key, s);
    }
    return s;
  }

  async acquire(key: string): Promise<() => void> {
    const s = this.for(key);
    await s.acquire();
    return () => s.release();
  }
}
