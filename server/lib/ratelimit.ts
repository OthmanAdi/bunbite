/**
 * BunBite — durable rate limiting + tier resolution (SQLite-backed).
 * Free tier is tracked per IP; Pro per validated key. Survives restart and is
 * correct across redeploys (no in-memory state). Replaces the old in-memory Map
 * and the "any key longer than 10 chars = Pro" bug.
 */
import { isActivePro, getUsage, incrementUsage } from "./db";

export interface RateLimitConfig {
  maxRequestsPerDay: number;
  maxFileSizeBytes: number;
  batchEnabled: boolean;
  maxBatchSize: number;
}

export const FREE: RateLimitConfig = {
  maxRequestsPerDay: 5, maxFileSizeBytes: 5 * 1048576, batchEnabled: false, maxBatchSize: 1,
};
export const PRO: RateLimitConfig = {
  maxRequestsPerDay: 500, maxFileSizeBytes: 50 * 1048576, batchEnabled: true, maxBatchSize: 20,
};

export type Tier = "free" | "pro";

export interface Access {
  tier: Tier;
  config: RateLimitConfig;
  subject: string; // usage bucket: "key:<k>" for pro, "ip:<addr>" for free
  apiKey?: string;
}

/** Resolve the caller's tier from a (validated) key, else fall back to free-by-IP. */
export function resolveAccess(apiKey: string | undefined | null, ip: string): Access {
  if (apiKey && isActivePro(apiKey)) {
    return { tier: "pro", config: PRO, subject: `key:${apiKey}`, apiKey };
  }
  return { tier: "free", config: FREE, subject: `ip:${ip}`, apiKey: apiKey || undefined };
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

export function increment(subject: string): void {
  incrementUsage(subject);
}

export function getRemaining(subject: string, config: RateLimitConfig): number {
  return Math.max(0, config.maxRequestsPerDay - getUsage(subject));
}
