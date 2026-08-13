/** Public hosted-mode policy, quota, and aggregate analytics tests. */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const dbPath = join(tmpdir(), `bunbite-core-${process.pid}-${Date.now()}.sqlite`);
process.env.DB_PATH = dbPath;
process.env.QUOTA_HASH_SECRET = "test-only-quota-hash-secret-32-characters";
process.env.ANALYTICS_RETENTION_DAYS = "30";

const {
  db, checkpointAndClose, recordAnalyticsEvent, getAnalyticsSummary, getUsage,
} = await import("../lib/db");
const {
  FixedWindowLimiter, resolveAccess, check, consume, refund, getRemaining, PUBLIC,
} = await import("../lib/ratelimit");

let fail = 0;
const ok = (condition: boolean, message: string) => {
  if (condition) console.log("  OK " + message);
  else { console.error("  X " + message); fail++; }
};

const first = resolveAccess("203.0.113.42");
const same = resolveAccess("203.0.113.42");
const other = resolveAccess("203.0.113.43");
ok(first.mode === "public" && first.config === PUBLIC, "every caller receives the public policy");
ok(
  PUBLIC.maxRequestsPerDay === 50 && PUBLIC.maxFileSizeBytes === 20 * 1_048_576
    && PUBLIC.batchEnabled && PUBLIC.maxBatchSize === 10,
  "public policy is 50 conversions, 20 MiB, batch up to 10",
);
ok(first.subject === same.subject && first.subject !== other.subject, "quota subjects are stable and caller-scoped");
ok(!first.subject.includes("203.0.113.42"), "quota subject contains no raw network address");

const shortBurst = new FixedWindowLimiter(2, 1_000, 3);
ok(shortBurst.allow("caller:a", 0) && shortBurst.allow("caller:a", 1), "burst limiter allows its fixed-window budget");
ok(!shortBurst.allow("caller:a", 2), "burst limiter blocks above its fixed-window budget");
shortBurst.allow("caller:b", 10);
shortBurst.allow("caller:c", 20);
shortBurst.allow("caller:d", 30);
ok(shortBurst.subjectCount === 3, "burst limiter enforces a hard pseudonymous-subject bound");
shortBurst.prune(1_031);
ok(shortBurst.subjectCount === 0, "burst limiter erases subjects immediately after window expiry on sweep");

db.query("INSERT INTO usage(subject, day, count) VALUES (?1, ?2, ?3)")
  .run("caller:expired-pseudonym", "2000-01-01", 7);
db.query("INSERT INTO usage(subject, day, count) VALUES (?1, ?2, ?3)")
  .run("caller:future-pseudonym", "2999-01-01", 7);
getUsage(first.subject);
ok(
  !db.query("SELECT 1 FROM usage WHERE day <> ?1 LIMIT 1").get(new Date().toISOString().slice(0, 10)),
  "quota access erases every pseudonymous subject row outside the current UTC day",
);

let granted = 0;
for (let i = 0; i < 55; i++) if (consume(first.subject, PUBLIC).allowed) granted++;
ok(granted === 50, "atomic daily quota grants exactly 50 conversions");
ok(!check(first.subject, PUBLIC).allowed && getRemaining(first.subject, PUBLIC) === 0, "daily quota blocks at 50");
refund(first.subject);
ok(consume(first.subject, PUBLIC).allowed, "a refunded conversion becomes available again");

recordAnalyticsEvent("page_view", "2026-08-13");
recordAnalyticsEvent("page_view", "2026-08-13");
recordAnalyticsEvent("download", "2026-08-13");
recordAnalyticsEvent("extension_link", "2000-01-01");
const summary = getAnalyticsSummary("2026-08-13");
ok(summary.retentionDays === 30, "analytics retention is explicit");
ok(summary.today.find((row) => row.event === "page_view")?.count === 2, "daily event counts aggregate");
ok(summary.totals.find((row) => row.event === "download")?.count === 1, "retained totals aggregate");
ok(!summary.totals.some((row) => row.event === "extension_link"), "expired aggregate day is pruned");
const analyticsColumns = (db.query("PRAGMA table_info(analytics_events)").all() as Array<{ name: string }>)
  .map((column) => column.name);
ok(
  analyticsColumns.join(",") === "day,event,count",
  "analytics table has no browser, user, quota-subject, or IP column",
);

checkpointAndClose();
for (let attempt = 0; attempt < 25; attempt++) {
  try {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
    break;
  } catch {
    await Bun.sleep(50);
  }
}
console.log(fail === 0 ? "\ncore PASS" : `\ncore FAIL: ${fail} problem(s)`);
process.exit(fail === 0 ? 0 : 1);
