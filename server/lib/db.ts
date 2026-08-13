/** BunBite public hosted-mode persistence: quota counters and aggregate events. */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/bunbite.sqlite";
try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch { /* already exists */ }

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    subject TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (subject, day)
  );
  CREATE TABLE IF NOT EXISTS analytics_events (
    day TEXT NOT NULL,
    event TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, event)
  );
`);

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Quota subjects are pseudonymous caller digests, not anonymous data. They are
// useful only for the active UTC quota window, so erase every older day before
// quota reads or writes. No historical per-caller usage is retained.
const qPruneUsage = db.query("DELETE FROM usage WHERE day <> ?1");
function pruneUsage(): void {
  qPruneUsage.run(today());
}
pruneUsage();

const qIncrementUsage = db.query(
  "INSERT INTO usage(subject, day, count) VALUES (?1, ?2, 1) " +
  "ON CONFLICT(subject, day) DO UPDATE SET count = count + 1 RETURNING count"
);
export function incrementUsage(subject: string): number {
  pruneUsage();
  const row = qIncrementUsage.get(subject, today()) as { count: number } | null;
  return row?.count ?? 0;
}

const qGetUsage = db.query("SELECT count FROM usage WHERE subject = ?1 AND day = ?2");
export function getUsage(subject: string): number {
  pruneUsage();
  const row = qGetUsage.get(subject, today()) as { count: number } | null;
  return row?.count ?? 0;
}

const qDecrementUsage = db.query(
  "UPDATE usage SET count = MAX(0, count - 1) WHERE subject = ?1 AND day = ?2"
);
export function decrementUsage(subject: string): void {
  pruneUsage();
  try { qDecrementUsage.run(subject, today()); } catch { /* best effort refund */ }
}

const analyticsRetentionDays = Math.max(
  30,
  Math.min(3650, Number(process.env.ANALYTICS_RETENTION_DAYS) || 400),
);
const qPruneAnalytics = db.query("DELETE FROM analytics_events WHERE day < ?1");
function pruneAnalytics(now = new Date()): void {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - analyticsRetentionDays);
  qPruneAnalytics.run(cutoff.toISOString().slice(0, 10));
}

const qRecordAnalytics = db.query(
  "INSERT INTO analytics_events(day, event, count) VALUES (?1, ?2, 1) " +
  "ON CONFLICT(day, event) DO UPDATE SET count = count + 1"
);
export function recordAnalyticsEvent(event: string, day = today()): void {
  pruneAnalytics();
  qRecordAnalytics.run(day, event);
}

const qAnalyticsTotals = db.query(
  "SELECT event, SUM(count) AS count FROM analytics_events GROUP BY event ORDER BY event"
);
const qAnalyticsDay = db.query(
  "SELECT event, count FROM analytics_events WHERE day = ?1 ORDER BY event"
);
export interface AnalyticsCount { event: string; count: number; }
export function getAnalyticsSummary(day = today()): {
  day: string;
  retentionDays: number;
  today: AnalyticsCount[];
  totals: AnalyticsCount[];
} {
  pruneAnalytics();
  return {
    day,
    retentionDays: analyticsRetentionDays,
    today: qAnalyticsDay.all(day) as AnalyticsCount[],
    totals: qAnalyticsTotals.all() as AnalyticsCount[],
  };
}

export function pingDb(): boolean {
  try { db.query("SELECT 1").get(); return true; } catch { return false; }
}

export function checkpointAndClose(): void {
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* best effort */ }
  try { db.close(); } catch { /* best effort */ }
}
