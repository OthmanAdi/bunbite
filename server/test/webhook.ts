/**
 * BunBite webhook signature verification tests.
 * Run: STRIPE_WEBHOOK_SECRET=whsec_test bun server/test/webhook.ts
 */
import { verifyWebhook } from "../lib/billing";
import { createHmac } from "node:crypto";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error("  ✗ " + m); fail++; } else console.log("  ✓ " + m); };

function sign(body: string, t: number, secret = SECRET): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

const now = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_1" } } });

const ev = verifyWebhook(body, sign(body, now));
ok(!!ev && ev.type === "checkout.session.completed", "valid signature accepted, event parsed");
ok(verifyWebhook(body + " ", sign(body, now)) === null, "tampered body rejected");
ok(verifyWebhook(body, sign(body, now, "whsec_wrong")) === null, "wrong secret rejected");
ok(verifyWebhook(body, sign(body, now - 10000)) === null, "stale timestamp (>300s) rejected");
ok(verifyWebhook(body, "garbage") === null, "malformed header rejected");
ok(verifyWebhook(body, null) === null, "missing header rejected");

console.log(fail === 0 ? "\n✅ webhook PASS" : `\n❌ webhook FAIL: ${fail} problem(s)`);
process.exit(fail === 0 ? 0 : 1);
