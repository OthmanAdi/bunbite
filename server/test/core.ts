/**
 * BunBite core tests — durable store, key validation, tier resolution, rate limiting.
 * Run with Bun (needs bun:sqlite). Two phases share one DB to prove restart durability:
 *   DB_PATH=tmp.sqlite KEYFILE=tmp.key bun server/test/core.ts all
 *   DB_PATH=tmp.sqlite KEYFILE=tmp.key bun server/test/core.ts verify
 */
import { mintProKey, isActivePro, getApiKey, incrementUsage, getUsage } from "../lib/db";
import { resolveAccess, check, increment, FREE, PRO } from "../lib/ratelimit";
import { writeFileSync, readFileSync } from "node:fs";

const mode = process.argv[2] || "all";
const KEYFILE = process.env.KEYFILE || "./.bbtest.key";
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error("  ✗ " + m); fail++; } else console.log("  ✓ " + m); };

if (mode === "all") {
  // mint + validate
  const key = mintProKey("test");
  ok(isActivePro(key), "minted key is active pro");
  ok(getApiKey(key)?.status === "active", "key row status active");

  // THE BUG FIX: unknown / garbage keys are NOT pro (old code: any 11+ chars = pro)
  ok(isActivePro("x".repeat(40)) === false, "unknown 40-char key is NOT pro (bug fixed)");
  ok(isActivePro("short") === false, "short unknown key not pro");
  ok(isActivePro(undefined) === false, "missing key not pro");

  // tier resolution
  const aPro = resolveAccess(key, "1.2.3.4");
  ok(aPro.tier === "pro" && aPro.config === PRO && aPro.subject === "key:" + key, "valid key -> pro, per-key subject");
  const aFree = resolveAccess("bogus-but-long-key-aaaaaaaaaaaa", "1.2.3.4");
  ok(aFree.tier === "free" && aFree.config === FREE && aFree.subject === "ip:1.2.3.4", "bogus key -> free, per-ip subject");

  // rate limit enforcement (free = 5/day), check-then-increment
  const subj = "ip:rl-test";
  let allowed = 0;
  for (let i = 0; i < 7; i++) { const r = check(subj, FREE); if (r.allowed) { allowed++; increment(subj); } }
  ok(allowed === FREE.maxRequestsPerDay, `free allowed exactly ${FREE.maxRequestsPerDay} (got ${allowed})`);
  ok(check(subj, FREE).allowed === false, "over-limit request blocked");
  ok(check(subj, FREE).resetAt.endsWith("Z"), "resetAt is an ISO instant");

  // persistence markers for phase 2
  writeFileSync(KEYFILE, key);
  incrementUsage("persist-test", "2000-01-01");
  incrementUsage("persist-test", "2000-01-01");
  incrementUsage("persist-test", "2000-01-01");
  ok(getUsage("persist-test", "2000-01-01") === 3, "usage atomic upsert counts to 3");
}

if (mode === "verify") {
  const key = readFileSync(KEYFILE, "utf8").trim();
  ok(isActivePro(key), "minted key STILL active after process restart (durable)");
  ok(getUsage("persist-test", "2000-01-01") === 3, "usage persisted across restart (=3)");
}

console.log(fail === 0 ? `\n✅ core PASS (${mode})` : `\n❌ core FAIL (${mode}): ${fail} problem(s)`);
process.exit(fail === 0 ? 0 : 1);
