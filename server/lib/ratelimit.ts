interface RateEntry { count: number; windowStart: number; }

interface RateLimitConfig {
  maxRequestsPerDay: number;
  maxFileSizeBytes: number;
  batchEnabled: boolean;
  maxBatchSize: number;
}

const FREE: RateLimitConfig = { maxRequestsPerDay: 5, maxFileSizeBytes: 5 * 1048576, batchEnabled: false, maxBatchSize: 1 };
const PRO: RateLimitConfig = { maxRequestsPerDay: 500, maxFileSizeBytes: 50 * 1048576, batchEnabled: true, maxBatchSize: 20 };

export class RateLimiter {
  private store = new Map<string, RateEntry>();
  private timer: ReturnType<typeof setInterval>;

  constructor() {
    this.timer = setInterval(() => {
      const now = Date.now();
      const day = 86400000;
      const keys = Array.from(this.store.keys());
      for (const key of keys) {
        const entry = this.store.get(key)!;
        if (now - entry.windowStart > day) this.store.delete(key);
      }
    }, 600000);
  }

  private key(ip: string) { return `${ip}:${new Date().toISOString().slice(0, 10)}`; }

  getConfigWithKey(apiKey?: string): RateLimitConfig {
    return (apiKey && apiKey.length > 10) ? PRO : FREE;
  }

  check(ip: string, config: RateLimitConfig) {
    const k = this.key(ip);
    const entry = this.store.get(k);
    const now = Date.now();
    if (!entry || now - entry.windowStart > 86400000) {
      this.store.set(k, { count: 0, windowStart: now });
      return { allowed: true, remaining: config.maxRequestsPerDay, resetAt: new Date(now + 86400000).toISOString() };
    }
    if (entry.count >= config.maxRequestsPerDay) {
      return { allowed: false, remaining: 0, resetAt: new Date(entry.windowStart + 86400000).toISOString() };
    }
    return { allowed: true, remaining: config.maxRequestsPerDay - entry.count, resetAt: new Date(entry.windowStart + 86400000).toISOString() };
  }

  increment(ip: string) {
    const k = this.key(ip);
    const e = this.store.get(k);
    if (e) e.count++; else this.store.set(k, { count: 1, windowStart: Date.now() });
  }

  getRemaining(ip: string, config: RateLimitConfig) {
    const e = this.store.get(this.key(ip));
    return e ? Math.max(0, config.maxRequestsPerDay - e.count) : config.maxRequestsPerDay;
  }

  destroy() { clearInterval(this.timer); }
}
