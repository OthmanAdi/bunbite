/**
 * BunBite public hosted-mode quotas.
 *
 * Callers share one capability set. A keyed HMAC of the network address is used
 * only as the durable quota bucket, so raw addresses and credentials never enter
 * SQLite. Production refuses to start without an operator-provided secret.
 */
import { createHmac } from "node:crypto";
import { getUsage, incrementUsage, decrementUsage } from "./db";

export interface RateLimitConfig {
  maxRequestsPerDay: number;
  maxFileSizeBytes: number;
  batchEnabled: boolean;
  maxBatchSize: number;
}

export const PUBLIC: RateLimitConfig = {
  maxRequestsPerDay: 50,
  maxFileSizeBytes: 20 * 1_048_576,
  batchEnabled: true,
  maxBatchSize: 10,
};

const configuredSecret = process.env.QUOTA_HASH_SECRET?.trim();
if (process.env.NODE_ENV === "production" && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error("QUOTA_HASH_SECRET must contain at least 32 characters in production");
}
const quotaSecret = configuredSecret || "bunbite-local-quota-secret-not-for-production";

export interface Access {
  mode: "public";
  config: RateLimitConfig;
  subject: string;
}

export class FixedWindowLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxSubjects: number,
  ) {
    if (limit < 1 || windowMs < 1 || maxSubjects < 1) {
      throw new Error("FixedWindowLimiter requires positive limits");
    }
  }

  allow(subject: string, now = Date.now()): boolean {
    this.prune(now);
    const entry = this.entries.get(subject);
    if (entry) {
      if (entry.count >= this.limit) return false;
      entry.count++;
      return true;
    }
    if (this.entries.size >= this.maxSubjects) this.evictOldest();
    this.entries.set(subject, { count: 1, resetAt: now + this.windowMs });
    return true;
  }

  prune(now = Date.now()): void {
    for (const [subject, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(subject);
    }
  }

  get subjectCount(): number {
    return this.entries.size;
  }

  private evictOldest(): void {
    let oldestSubject: string | undefined;
    let oldestReset = Number.POSITIVE_INFINITY;
    for (const [subject, entry] of this.entries) {
      if (entry.resetAt < oldestReset) {
        oldestReset = entry.resetAt;
        oldestSubject = subject;
      }
    }
    if (oldestSubject !== undefined) this.entries.delete(oldestSubject);
  }
}

/** Build the sole public access policy. Authentication headers are irrelevant. */
export function resolveAccess(networkAddress: string): Access {
  const digest = createHmac("sha256", quotaSecret).update(networkAddress).digest("hex");
  return { mode: "public", config: PUBLIC, subject: `caller:${digest}` };
}

function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

export interface LimitResult { allowed: boolean; remaining: number; resetAt: string; }

export function check(subject: string, config: RateLimitConfig): LimitResult {
  const used = getUsage(subject);
  const resetAt = nextUtcMidnight();
  if (used >= config.maxRequestsPerDay) return { allowed: false, remaining: 0, resetAt };
  return { allowed: true, remaining: config.maxRequestsPerDay - used, resetAt };
}

/** Atomically reserve one daily conversion unit. */
export function consume(subject: string, config: RateLimitConfig): LimitResult {
  const used = incrementUsage(subject);
  const resetAt = nextUtcMidnight();
  if (used > config.maxRequestsPerDay) {
    decrementUsage(subject);
    return { allowed: false, remaining: 0, resetAt };
  }
  return { allowed: true, remaining: config.maxRequestsPerDay - used, resetAt };
}

export function refund(subject: string): void {
  decrementUsage(subject);
}

export function increment(subject: string): void {
  incrementUsage(subject);
}

export function getRemaining(subject: string, config: RateLimitConfig): number {
  return Math.max(0, config.maxRequestsPerDay - getUsage(subject));
}
