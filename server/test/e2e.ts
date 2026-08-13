/** Live HTTP proof for the single public hosted mode and aggregate analytics. */
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rmSync } from "node:fs";

const repoRoot = resolve(import.meta.dir, "../..");
const serverEntry = resolve(import.meta.dir, "../server.ts");
const dbPath = join(tmpdir(), `bunbite-e2e-${process.pid}-${Date.now()}.sqlite`);
const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = probe.port;
await probe.stop();

const env = { ...process.env } as Record<string, string>;
Object.assign(env, {
  DB_PATH: dbPath,
  PORT: String(port),
  BURST_MAX: "100",
  QUOTA_HASH_SECRET: "test-only-quota-hash-secret-32-characters",
  ANALYTICS_ADMIN_TOKEN: "analytics-test-admin-token",
  TRUST_PROXY: "1",
});
for (const name of [
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY",
  "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY", "STRIPE_PRODUCT_ID",
]) delete env[name];

const child = Bun.spawn(["bun", serverEntry], {
  cwd: repoRoot, env, stdout: "pipe", stderr: "pipe",
});
const base = `http://127.0.0.1:${port}`;
let fail = 0;
const ok = (condition: boolean, message: string) => {
  if (condition) console.log("  OK " + message);
  else { console.error("  X " + message); fail++; }
};

async function ready(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* booting */ }
    await Bun.sleep(25);
  }
  return false;
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

try {
  ok(await ready(), "server boots in public mode");
  const health = await (await fetch(`${base}/api/health`)).json() as any;
  ok(health.status === "ok" && health.db === true && !("keyDeliveryBacklog" in health), "health has no billing worker state");

  const config = await (await fetch(`${base}/api/config`)).json() as any;
  ok(
    config.mode === "public" && config.limit === 50 && config.maxFileSizeMB === 20
      && config.batchEnabled === true && config.maxBatchSize === 10 && !("billing" in config),
    "config exposes one public 50/day, 20 MiB, batch-10 policy",
  );
  const anonymousStatus = await (await fetch(`${base}/api/status`)).json() as any;
  const keyedStatus = await (await fetch(`${base}/api/status`, {
    headers: { "X-API-Key": "bunbite_obsolete_key_must_be_ignored" },
  })).json() as any;
  ok(
    anonymousStatus.mode === "public" && keyedStatus.mode === "public"
      && anonymousStatus.limit === keyedStatus.limit && anonymousStatus.remaining === keyedStatus.remaining,
    "API key header cannot select another mode or quota",
  );

  for (const [path, method] of [
    ["/api/checkout", "POST"], ["/api/portal", "POST"],
    ["/api/checkout/session?session_id=old", "GET"], ["/api/stripe/webhook", "POST"],
    ["/pricing.html", "GET"],
  ] as const) {
    ok((await fetch(base + path, { method })).status === 404, `${path.split("?")[0]} is absent`);
  }

  const invalid = await fetch(`${base}/api/analytics/event`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ event: "visitor_id" }),
  });
  ok(invalid.status === 400, "analytics rejects a non-allowlisted event");
  const extra = await fetch(`${base}/api/analytics/event`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ event: "page_view", user: "forbidden" }),
  });
  ok(extra.status === 400, "analytics rejects identifier-bearing extra fields");
  const crossOrigin = await fetch(`${base}/api/analytics/event`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
    body: JSON.stringify({ event: "page_view" }),
  });
  ok(crossOrigin.status === 403, "analytics rejects cross-origin browser posts");
  const wrongScheme = await fetch(`${base}/api/analytics/event`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base.replace("http:", "https:") },
    body: JSON.stringify({ event: "page_view" }),
  });
  ok(wrongScheme.status === 403, "analytics rejects a matching host with a different scheme");
  const missingOrigin = await fetch(`${base}/api/analytics/event`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "page_view" }),
  });
  ok(missingOrigin.status === 403, "analytics requires an Origin header");
  const forwardedSameOrigin = await fetch(`${base}/api/analytics/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://public.example.test",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "public.example.test",
      "Fly-Client-IP": "203.0.113.55",
    },
    body: JSON.stringify({ event: "download" }),
  });
  ok(forwardedSameOrigin.status === 204, "trusted proxy HTTPS origin is accepted exactly");
  const forwardedWrongScheme = await fetch(`${base}/api/analytics/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://public.example.test",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "public.example.test",
      "Fly-Client-IP": "203.0.113.55",
    },
    body: JSON.stringify({ event: "download" }),
  });
  ok(forwardedWrongScheme.status === 403, "trusted proxy rejects the same host with the wrong scheme");
  const oversized = await fetch(`${base}/api/analytics/event`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: "x".repeat(97),
  });
  ok(oversized.status === 413, "analytics body is capped below 100 bytes");
  for (const event of ["page_view", "page_view", "extension_link"]) {
    const response = await fetch(`${base}/api/analytics/event`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ event }),
    });
    ok(response.status === 204, `${event} aggregate event accepted`);
  }
  const missingAdmin = await fetch(`${base}/api/analytics/summary`);
  ok(
    missingAdmin.status === 401 && !missingAdmin.headers.has("access-control-allow-origin"),
    "analytics summary 401 has no CORS header",
  );
  const wrongAdmin = await fetch(`${base}/api/analytics/summary`, {
    headers: { Authorization: "Bearer wrong" },
  });
  ok(
    wrongAdmin.status === 401 && !wrongAdmin.headers.has("access-control-allow-origin"),
    "analytics summary rejects a wrong token without CORS",
  );
  const summaryResponse = await fetch(`${base}/api/analytics/summary`, {
    headers: { Authorization: "Bearer analytics-test-admin-token" },
  });
  const summary = await summaryResponse.json() as any;
  ok(
    summary.today.find((row: any) => row.event === "page_view")?.count === 2
      && summary.totals.find((row: any) => row.event === "extension_link")?.count === 1,
    "protected summary returns event counts only",
  );
  ok(!summaryResponse.headers.has("access-control-allow-origin"), "admin summary does not advertise cross-origin access");

  const batchData = new FormData();
  for (let i = 0; i < 11; i++) {
    batchData.append("images", new Blob([PNG_1X1], { type: "image/png" }), `${i}.png`);
  }
  const batchResponse = await fetch(`${base}/api/batch`, { method: "POST", body: batchData });
  const batch = await batchResponse.json() as any;
  ok(batchResponse.status === 200 && batch.results.length === 10, "public batch processes at most 10 images");
  ok(batch.remaining === 40, "batch charges one daily conversion per processed image");

  ok((await fetch(`${base}/definitely-not-here`)).status === 404, "unknown route remains a real 404");
} finally {
  child.kill("SIGTERM");
  await child.exited.catch(() => {});
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  ok(!stdout.includes('"ip":'), "access logs contain no raw-IP field");
  if (stderr.trim()) console.error(stderr.trim());
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
}

console.log(fail === 0 ? "\ne2e PASS" : `\ne2e FAIL: ${fail} problem(s)`);
process.exit(fail === 0 ? 0 : 1);
