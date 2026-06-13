/**
 * BunBite — durable store (bun:sqlite, zero external deps).
 * Holds customers, API keys, daily usage, and checkout->key links.
 * Survives restart via a SQLite file (on Fly: a mounted volume at /data).
 */
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/bunbite.sqlite";

// Make sure the parent directory exists before opening (empty Fly volume on first boot).
try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch { /* already exists */ }

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stripe_customer_id TEXT UNIQUE,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    customer_id INTEGER,
    tier TEXT NOT NULL DEFAULT 'pro',
    status TEXT NOT NULL DEFAULT 'active',
    stripe_subscription_id TEXT,
    plan TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS usage (
    subject TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (subject, day)
  );
  CREATE TABLE IF NOT EXISTS checkout_links (
    session_id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_sub ON api_keys(stripe_subscription_id);
`);

// ─── helpers ───
export function today(): string {
  return new Date().toISOString().slice(0, 10); // UTC day bucket
}

export function genKey(): string {
  return "bunbite_" + randomBytes(24).toString("hex"); // 48 hex chars, high entropy
}

// ─── API keys ───
const qGetKey = db.query(
  "SELECT key, customer_id, tier, status, plan, stripe_subscription_id FROM api_keys WHERE key = ?1"
);
export interface ApiKeyRow {
  key: string; customer_id: number | null; tier: string; status: string;
  plan: string | null; stripe_subscription_id: string | null;
}
export function getApiKey(key?: string | null): ApiKeyRow | null {
  if (!key) return null;
  return (qGetKey.get(key) as ApiKeyRow) || null;
}

/** True only for a key that exists, is active, and is the pro tier. Kills the old "any key = pro" bug. */
export function isActivePro(key?: string | null): boolean {
  const row = getApiKey(key);
  return !!row && row.status === "active" && row.tier === "pro";
}

const qTouch = db.query("UPDATE api_keys SET last_used_at = datetime('now') WHERE key = ?1");
export function touchApiKey(key: string): void { try { qTouch.run(key); } catch { /* noop */ } }

// ─── usage (atomic) ───
const qIncr = db.query(
  "INSERT INTO usage(subject, day, count) VALUES (?1, ?2, 1) " +
  "ON CONFLICT(subject, day) DO UPDATE SET count = count + 1 RETURNING count"
);
export function incrementUsage(subject: string, day = today()): number {
  const row = qIncr.get(subject, day) as { count: number } | null;
  return row ? row.count : 0;
}

const qGetUsage = db.query("SELECT count FROM usage WHERE subject = ?1 AND day = ?2");
export function getUsage(subject: string, day = today()): number {
  const row = qGetUsage.get(subject, day) as { count: number } | null;
  return row ? row.count : 0;
}

// ─── customers + key minting ───
const qUpsertCustomer = db.query(
  "INSERT INTO customers(stripe_customer_id, email) VALUES (?1, ?2) " +
  "ON CONFLICT(stripe_customer_id) DO UPDATE SET email = COALESCE(excluded.email, email) RETURNING id"
);
export function upsertCustomer(stripeCustomerId: string, email?: string | null): number {
  const row = qUpsertCustomer.get(stripeCustomerId, email ?? null) as { id: number };
  return row.id;
}

const qGetLink = db.query("SELECT key FROM checkout_links WHERE session_id = ?1");
const qInsertLink = db.query("INSERT OR IGNORE INTO checkout_links(session_id, key) VALUES (?1, ?2)");
const qInsertKey = db.query(
  "INSERT OR IGNORE INTO api_keys(key, customer_id, tier, status, stripe_subscription_id, plan) " +
  "VALUES (?1, ?2, 'pro', 'active', ?3, ?4)"
);

/**
 * Idempotent mint: one key per checkout session. The webhook and the success-page reveal
 * can race; INSERT OR IGNORE + the session->key link guarantee a single key is issued.
 */
export function ensureKeyForCheckout(opts: {
  sessionId: string;
  stripeCustomerId?: string | null;
  email?: string | null;
  subscriptionId?: string | null;
  plan?: string | null;
}): string {
  const pre = qGetLink.get(opts.sessionId) as { key: string } | null;
  if (pre) return pre.key;

  const run = db.transaction(() => {
    const again = qGetLink.get(opts.sessionId) as { key: string } | null;
    if (again) return again.key;
    const customerId = opts.stripeCustomerId ? upsertCustomer(opts.stripeCustomerId, opts.email) : null;
    const key = genKey();
    qInsertKey.run(key, customerId, opts.subscriptionId ?? null, opts.plan ?? null);
    qInsertLink.run(opts.sessionId, key);
    return key;
  });
  return run();
}

/** Direct pro-key mint (used by tests / manual grants, no Stripe). */
export function mintProKey(plan = "manual"): string {
  const key = genKey();
  qInsertKey.run(key, null, null, plan);
  return key;
}

// ─── subscription lifecycle ───
const qRevokeBySub = db.query("UPDATE api_keys SET status = 'revoked' WHERE stripe_subscription_id = ?1");
const qActivateBySub = db.query("UPDATE api_keys SET status = 'active' WHERE stripe_subscription_id = ?1");
export function setSubscriptionActive(subId: string, active: boolean): void {
  (active ? qActivateBySub : qRevokeBySub).run(subId);
}
