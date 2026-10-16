/**
 * Sliding-window rate limiter in memory, keyed by user id.
 * Each key keeps the timestamps of its requests inside the window; stale keys are swept lazily
 * (at most once per window), so memory is bounded by the number of recently active users.
 */
export function createRateLimiter(opts: { limit: number; windowMs?: number; now?: () => number }) {
  const windowMs = opts.windowMs ?? 60_000;
  const now = opts.now ?? Date.now;
  let limit = opts.limit;
  const hits = new Map<number, number[]>();
  let lastSweep = now();

  function sweep(t: number) {
    lastSweep = t;
    for (const [key, times] of hits) {
      if (times.length === 0 || times[times.length - 1]! <= t - windowMs) hits.delete(key);
    }
  }

  return {
    /** Registers a request; returns false when the key is over the limit (the request is not counted). */
    allow(key: number): boolean {
      const t = now();
      if (t - lastSweep >= windowMs) sweep(t);
      const times = hits.get(key) ?? [];
      let start = 0;
      while (start < times.length && times[start]! <= t - windowMs) start++;
      if (start > 0) times.splice(0, start);
      if (times.length >= limit) {
        hits.set(key, times);
        return false;
      }
      times.push(t);
      hits.set(key, times);
      return true;
    },
    setLimit(n: number) {
      limit = n;
    },
    reset() {
      hits.clear();
    },
    /** Number of tracked keys (for tests). */
    size: () => hits.size,
  };
}
