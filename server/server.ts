import type { Server } from "bun";
import { timingSafeEqual } from "node:crypto";
import { resolve, sep } from "node:path";
import { optimizeImage, optimizeBatch } from "./lib/optimizer";
import {
  FixedWindowLimiter, resolveAccess, consume, refund, getRemaining, type Access,
} from "./lib/ratelimit";
import {
  pingDb, checkpointAndClose, recordAnalyticsEvent, getAnalyticsSummary,
} from "./lib/db";

const PORT = Number(process.env.PORT) || 3000;

// When TRUST_PROXY is set we are behind Fly's edge (or another trusted reverse
// proxy) and may believe its forwarding headers; otherwise those headers are
// spoofable and we MUST use the real socket address instead.
const TRUST_PROXY = !!process.env.TRUST_PROXY;

// ── Bounded image work ───────────────────────────────────────────────────────
// shared-cpu-1x is ~1 vCPU and image decode/encode is CPU-bound and largely
// synchronous inside Bun.Image; letting many run at once just thrashes and can
// OOM the 512MB machine. So we cap concurrency and queue a little, shedding load
// (503 + Retry-After) past the queue. CEILING: this is a per-machine limiter.
// Upgrade path = bigger VM (raise IMAGE_CONCURRENCY) or multi-machine (move the
// queue behind a shared broker). Knobs stay as env so ops can tune without code.
const IMAGE_CONCURRENCY = Number(process.env.IMAGE_CONCURRENCY) || 2;
const IMAGE_QUEUE_MAX = Number(process.env.IMAGE_QUEUE_MAX) || 24;
let active = 0;
const waiters: Array<() => void> = [];

/** Acquire a work slot. Returns a promise that resolves when the slot is free,
 *  or null when the queue is full (caller should shed the request). */
function acquireSlot(): Promise<void> | null {
  if (active < IMAGE_CONCURRENCY) { active++; return Promise.resolve(); }
  if (waiters.length >= IMAGE_QUEUE_MAX) return null;
  return new Promise<void>((res) => waiters.push(res));
}
function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next();      // hand the slot straight to the next waiter (active unchanged)
  else active--;
}

// ── Per-subject burst limiter (fixed window, in-memory) ──────────────────────
// Stops one caller firing a whole day's quota in a single second at a 1-CPU box.
// CEILING: in-memory means per-machine and it resets on restart, which is exactly
// right for the committed single-machine architecture. Multi-machine upgrade path
// = a shared store (SQLite/Redis) keyed by subject.
const BURST_MAX = Number(process.env.BURST_MAX) || 15;
const BURST_WINDOW_MS = Number(process.env.BURST_WINDOW_MS) || 10_000;
const burst = new FixedWindowLimiter(BURST_MAX, BURST_WINDOW_MS, 5_000);
const analyticsBurst = new FixedWindowLimiter(60, 60_000, 2_000);
const burstSweepMs = Math.max(1_000, Math.min(BURST_WINDOW_MS, 10_000));
const burstSweepTimer = setInterval(() => {
  burst.prune();
  analyticsBurst.prune();
}, burstSweepMs);
burstSweepTimer.unref();

// Total bytes a single batch request may carry before we buffer it.
const BATCH_TOTAL_MAX_BYTES = Number(process.env.BATCH_TOTAL_MAX_BYTES) || 64 * 1_048_576;
const ANALYTICS_BODY_MAX_BYTES = 96;
const ANALYTICS_EVENTS = new Set([
  "page_view", "local_optimize", "cloud_optimize", "batch_optimize",
  "download", "extension_link",
]);

// CSP is built to match the FROZEN public/ pages: inline <script>/<style> blocks
// (unsafe-inline), Google Fonts (googleapis stylesheet + gstatic font files),
// a data: SVG favicon, and client-side blob: image results. connect-src 'self'
// covers the /api/* calls.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const PUBLIC_ROOT = resolve("./public");

function getClientIP(req: Request, server: Server): string {
  if (TRUST_PROXY) {
    const fly = req.headers.get("fly-client-ip");
    if (fly) return fly.trim();
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
  }
  // Not behind a trusted proxy: real socket address, ignore spoofable headers.
  return server.requestIP(req)?.address || "127.0.0.1";
}

function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

function err(message: string, status = 400, extra?: Record<string, string>): Response {
  return json({ error: message }, status, extra);
}

function privateJson(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

function privateErr(message: string, status: number, extra?: Record<string, string>): Response {
  return privateJson({ error: message }, status, extra);
}

const PRIVATE_PAGE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, private, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};

let shuttingDown = false;

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  maxRequestBodySize: 100 * 1024 * 1024,

  async fetch(req, server) {
    const started = performance.now();
    const url = new URL(req.url);
    const ip = getClientIP(req, server);
    const reqId = crypto.randomUUID().slice(0, 8);
    let mode = "-";

    let res: Response;
    try {
      res = await route(req, url, ip, (value) => { mode = value; });
    } catch (e: any) {
      console.error("Unhandled error:", e);
      res = err("Internal error", 500);
    }

    // One-line JSON access log (skip the every-15s health probe to cut noise).
    if (url.pathname !== "/api/health") {
      console.log(JSON.stringify({
        t: new Date().toISOString(), id: reqId,
        m: req.method, p: url.pathname, s: res.status, mode,
        ms: Math.round(performance.now() - started),
      }));
    }
    return res;
  },
});

async function route(
  req: Request, url: URL, ip: string,
  setMode: (mode: string) => void,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    if (url.pathname.startsWith("/api/analytics/")) {
      return new Response(null, { status: 204, headers: { "Allow": "GET, POST, OPTIONS" } });
    }
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (url.pathname === "/api/optimize" && req.method === "POST") {
    const access = resolveAccess(ip); setMode(access.mode);
    return handleOptimize(req, access);
  }
  if (url.pathname === "/api/batch" && req.method === "POST") {
    const access = resolveAccess(ip); setMode(access.mode);
    return handleBatch(req, access);
  }
  if (url.pathname === "/api/status" && req.method === "GET") {
    const access = resolveAccess(ip); setMode(access.mode);
    return handleStatus(access);
  }
  if (url.pathname === "/api/analytics/event" && req.method === "POST") {
    setMode("public");
    return handleAnalyticsEvent(req, resolveAccess(ip).subject);
  }
  if (url.pathname === "/api/analytics/summary" && req.method === "GET") {
    setMode("admin");
    return handleAnalyticsSummary(req);
  }
  if (url.pathname === "/api/health") {
    const dbOk = pingDb();
    return json({
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      engine: "bun-image",
      version: "1.0.0",
    }, dbOk ? 200 : 503);
  }
  if (url.pathname === "/api/config" && req.method === "GET") {
    return json({
      mode: "public",
      limit: 50,
      maxFileSizeMB: 20,
      batchEnabled: true,
      maxBatchSize: 10,
    });
  }

  return serveStatic(url);
}

async function handleOptimize(req: Request, access: Access): Promise<Response> {
  const { config, subject } = access;

  // Both refusals are 429, so the body carries reason: "burst" (transient
  // throttle, retry after Retry-After) vs "daily" (hard cap until UTC midnight).
  // Additive and contract-safe: old clients that only read `error` still work.
  if (!burst.allow(subject)) {
    return json(
      { error: "Too many requests, slow down.", reason: "burst" },
      429, { "Retry-After": String(Math.ceil(BURST_WINDOW_MS / 1000)) },
    );
  }

  // Body-size guard BEFORE buffering. A missing content-length means a chunked
  // upload that would bypass the early 413, so require the header.
  const clHeader = req.headers.get("content-length");
  if (clHeader === null) return err("Length required.", 411);
  const contentLength = Number(clHeader);
  if (contentLength > config.maxFileSizeBytes + 1_048_576) {
    return err(`File too large. Max ${(config.maxFileSizeBytes / 1048576).toFixed(0)}MB.`, 413);
  }

  // Atomically reserve the quota unit (closes the check-then-increment race).
  const limit = consume(subject, config);
  if (!limit.allowed) {
    return json({ error: `Rate limit exceeded. Resets at ${limit.resetAt}.`, reason: "daily" }, 429);
  }

  // Bound concurrent CPU-bound work; shed past the queue rather than OOM.
  const slot = acquireSlot();
  if (slot === null) {
    refund(subject);
    return err("Server busy, retry shortly.", 503, { "Retry-After": "2" });
  }
  await slot;

  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) { refund(subject); return err("No image file provided."); }
    if (file.size > config.maxFileSizeBytes) {
      refund(subject);
      return err(`File too large. Max ${(config.maxFileSizeBytes / 1048576).toFixed(0)}MB.`, 413);
    }

    const format = (formData.get("format") as string) || "webp";
    const quality = Math.min(100, Math.max(1, Number(formData.get("quality")) || 80));
    const width = formData.get("width") ? Number(formData.get("width")) : undefined;
    const height = formData.get("height") ? Number(formData.get("height")) : undefined;
    const fit = ((formData.get("fit") as string) || "inside") as "fill" | "inside";
    const withoutEnlargement = formData.get("withoutEnlargement") !== "false";
    const progressive = formData.get("progressive") === "true";

    if (!["jpeg", "png", "webp"].includes(format)) {
      refund(subject);
      return err("Invalid format. Use: jpeg, png, or webp");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await optimizeImage(buffer, {
      format: format as "jpeg" | "png" | "webp",
      quality, width, height, fit, withoutEnlargement, progressive,
    });

    return new Response(result.data, {
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `inline; filename="optimized.${result.format}"`,
        "Access-Control-Allow-Origin": "*",
        "X-Original-Size": String(result.originalSize),
        "X-Optimized-Size": String(result.optimizedSize),
        "X-Saved-Percent": String(result.savedPercent),
        "X-Width": String(result.width),
        "X-Height": String(result.height),
        "X-Original-Width": String(result.originalWidth),
        "X-Original-Height": String(result.originalHeight),
        "X-Remaining": String(getRemaining(subject, config)),
        "X-Engine": "bun-image",
      },
    });
  } catch (e: any) {
    refund(subject); // reserved-but-unspent unit goes back on any failure
    // Bun.Image prefixes every decode failure with "Image:"; that is bad client
    // input (corrupt file, HEIC, truncated bytes), not a server fault, so it maps
    // to 422 with a generic message and never leaks the engine wording. CEILING:
    // prefix-matching the error string; a Bun.Image message rewording would send
    // decode failures back to 500 (visibly, in error monitoring) until re-matched.
    if (String(e?.message || "").startsWith("Image:")) {
      return err("Could not decode image. Use JPEG, PNG, WebP, BMP, or GIF.", 422);
    }
    console.error("Optimize error:", e);
    return err(e.message || "Internal error", 500);
  } finally {
    releaseSlot();
  }
}

async function handleBatch(req: Request, access: Access): Promise<Response> {
  const { config, subject } = access;

  if (!burst.allow(subject)) {
    return json(
      { error: "Too many requests, slow down.", reason: "burst" },
      429, { "Retry-After": String(Math.ceil(BURST_WINDOW_MS / 1000)) },
    );
  }

  const clHeader = req.headers.get("content-length");
  if (clHeader === null) return err("Length required.", 411);
  const contentLength = Number(clHeader);
  // Per-tier ceiling clamped to a hard total the 512MB box can buffer.
  const batchCap = Math.min(config.maxFileSizeBytes * config.maxBatchSize, BATCH_TOTAL_MAX_BYTES) + 1_048_576;
  if (contentLength > batchCap) return err("Batch payload too large.", 413);

  const slot = acquireSlot();
  if (slot === null) return err("Server busy, retry shortly.", 503, { "Retry-After": "2" });
  await slot;

  try {
    const formData = await req.formData();
    const format = ((formData.get("format") as string) || "webp") as "jpeg" | "png" | "webp";
    const quality = Math.min(100, Math.max(1, Number(formData.get("quality")) || 80));
    const width = formData.get("width") ? Number(formData.get("width")) : undefined;
    const height = formData.get("height") ? Number(formData.get("height")) : undefined;

    const files: { name: string; buffer: Buffer }[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "images" && value instanceof File) {
        if (value.size <= config.maxFileSizeBytes) {
          files.push({ name: value.name, buffer: Buffer.from(await value.arrayBuffer()) });
        }
      }
    }
    if (files.length === 0) return err("No image files provided.");

    // Atomically reserve one quota unit per file we will process; stop as soon as
    // the daily cap is hit so we never exceed it under concurrency. Never reserve
    // beyond maxBatchSize: optimizeBatch caps processing there, so surplus files
    // are dropped un-refunded and would over-charge the caller's quota otherwise.
    const willProcess = Math.min(files.length, config.maxBatchSize);
    let reserved = 0;
    for (let i = 0; i < willProcess; i++) {
      if (consume(subject, config).allowed) reserved++;
      else break;
    }
    if (reserved === 0) return json({ error: "Rate limit exceeded.", reason: "daily" }, 429);
    const toProcess = files.slice(0, reserved);

    const { results, errors } = await optimizeBatch(toProcess, { format, quality, width, height }, config.maxBatchSize);
    // Files that failed to decode did not consume real work: refund them.
    for (let i = 0; i < errors.length; i++) refund(subject);
    return json({
      results: results.map(r => ({
        originalSize: r.originalSize, optimizedSize: r.optimizedSize,
        savedPercent: r.savedPercent, width: r.width, height: r.height,
        format: r.format, data: Buffer.from(r.data).toString("base64"), mimeType: r.mimeType,
      })),
      errors,
      remaining: getRemaining(subject, config),
    });
  } catch (e: any) {
    console.error("Batch error:", e);
    return err(e.message || "Internal error", 500);
  } finally {
    releaseSlot();
  }
}

function handleStatus(access: Access): Response {
  const { mode, config, subject } = access;
  return json({
    mode,
    remaining: getRemaining(subject, config),
    limit: config.maxRequestsPerDay,
    maxFileSizeMB: config.maxFileSizeBytes / 1048576,
    batchEnabled: config.batchEnabled,
    maxBatchSize: config.maxBatchSize,
    engine: "bun-image",
  });
}

async function handleAnalyticsEvent(req: Request, subject: string): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!origin) return err("Origin required.", 403);
  let suppliedOrigin: URL;
  try { suppliedOrigin = new URL(origin); } catch { return err("Invalid origin.", 403); }
  const expectedOrigin = effectiveRequestOrigin(req);
  if (!expectedOrigin || !["http:", "https:"].includes(suppliedOrigin.protocol)
    || suppliedOrigin.username || suppliedOrigin.password
    || suppliedOrigin.pathname !== "/" || suppliedOrigin.search || suppliedOrigin.hash
    || suppliedOrigin.origin !== expectedOrigin) {
    return err("Cross-origin analytics denied.", 403);
  }
  if (!analyticsBurst.allow(subject)) {
    return err("Too many analytics events.", 429, { "Retry-After": "60" });
  }
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader === null) return err("Length required.", 411);
  const length = Number(lengthHeader);
  if (!Number.isInteger(length) || length < 2 || length > ANALYTICS_BODY_MAX_BYTES) {
    return err("Analytics payload too large.", 413);
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1
    || typeof body.event !== "string" || !ANALYTICS_EVENTS.has(body.event)) {
    return err("Unsupported analytics event.", 400);
  }
  recordAnalyticsEvent(body.event);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function effectiveRequestOrigin(req: Request): string | null {
  try {
    const requestUrl = new URL(req.url);
    if (!TRUST_PROXY) return requestUrl.origin;
    const forwardedProtocol = req.headers.get("x-forwarded-proto")
      ?.split(",")[0]?.trim().toLowerCase();
    const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;
    const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || req.headers.get("host")?.trim() || requestUrl.host;
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

function constantTimeTokenMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function handleAnalyticsSummary(req: Request): Response {
  const expected = process.env.ANALYTICS_ADMIN_TOKEN?.trim();
  if (!expected) return privateErr("Analytics summary is not configured.", 503);
  const authorization = req.headers.get("authorization") || "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!candidate || !constantTimeTokenMatch(candidate, expected)) {
    return privateErr("Unauthorized.", 401, { "WWW-Authenticate": "Bearer" });
  }
  return privateJson(getAnalyticsSummary());
}

async function serveStatic(url: URL): Promise<Response> {
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return notFound(); } // malformed percent-encoding

  if (pathname === "/" || pathname === "") pathname = "/index.html";
  // Explicit path-traversal guard: reject parent refs, backslashes (Windows path
  // separator), and NUL, then confirm the resolved path stays inside ./public.
  if (pathname.includes("..") || pathname.includes("\\") || pathname.includes("\0")) {
    return notFound();
  }
  const filePath = resolve(PUBLIC_ROOT, "." + pathname);
  if (filePath !== PUBLIC_ROOT && !filePath.startsWith(PUBLIC_ROOT + sep)) {
    return notFound();
  }

  const file = Bun.file(filePath);
  if (await file.exists()) {
    const ext = pathname.split(".").pop() || "";
    const mimes: Record<string, string> = {
      html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
      js: "application/javascript; charset=utf-8", json: "application/json",
      png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml",
      ico: "image/x-icon", woff2: "font/woff2",
      txt: "text/plain; charset=utf-8", xml: "application/xml; charset=utf-8",
      webmanifest: "application/manifest+json",
    };
    const isHtml = ext === "html";
    const isPrivatePage = pathname === "/success.html";
    // Versioned (?v=) assets are content-addressed by the query, so they can be
    // cached immutably for a year; everything else gets a modest TTL.
    const versioned = url.searchParams.has("v");
    const cache = isPrivatePage ? PRIVATE_PAGE_HEADERS["Cache-Control"]!
      : isHtml ? "no-cache"
      : versioned ? "public, max-age=31536000, immutable"
      : "public, max-age=86400";

    const headers: Record<string, string> = {
      "Content-Type": mimes[ext] || "application/octet-stream",
      "Cache-Control": cache,
      ...securityHeaders(isHtml),
    };
    if (isPrivatePage) Object.assign(headers, PRIVATE_PAGE_HEADERS);
    if (isHtml) {
      let source = renderOriginMetadata(await file.text(), pathname);
      return new Response(source, { headers });
    }
    return new Response(file, { headers });
  }

  return notFound();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function configuredPublicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password
      || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function renderOriginMetadata(source: string, pathname: string): string {
  const marker = "<!-- runtime-origin-metadata -->";
  const base = configuredPublicBaseUrl();
  if (!base) return source.replace(marker, "");
  const publicPath = pathname === "/index.html" ? "/" : pathname;
  const pageUrl = new URL(publicPath, base + "/").toString();
  const imageUrl = new URL("/og.png", base + "/").toString();
  const tags = [
    `<link rel="canonical" href="${escapeHtml(pageUrl)}">`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
  ];
  if (pathname === "/index.html") {
    const canonical = pageUrl;
    for (const lang of ["en", "de", "ar"]) {
      const localized = new URL(canonical);
      localized.searchParams.set("lang", lang);
      tags.push(`<link rel="alternate" hreflang="${lang}" href="${escapeHtml(localized.toString())}">`);
    }
    tags.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(canonical)}">`);
  }
  return source.replace(marker, tags.join("\n  "));
}

// Security headers. CSP only on HTML (it governs page resource loading); the
// cheap framing/sniffing/referrer headers go on all static responses; HSTS only
// when we know we are served over HTTPS behind the trusted proxy.
function securityHeaders(isHtml: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  if (isHtml) h["Content-Security-Policy"] = CSP;
  if (TRUST_PROXY) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return h;
}

function notFound(): Response {
  // Real 404 for unknown paths: no homepage catch-all (it 200-ed arbitrary URLs
  // with duplicate content, which breaks canonicalization and crawl budgets).
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
// On SIGTERM/SIGINT: stop accepting new connections, let in-flight requests
// drain, checkpoint the WAL into the main db file, then close and exit. A hard
// deadline guarantees we still exit if a request hangs.
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(burstSweepTimer);
  console.log(JSON.stringify({ t: new Date().toISOString(), evt: "shutdown", signal }));
  setTimeout(() => { try { checkpointAndClose(); } catch {} process.exit(0); }, 5000).unref();
  try { await server.stop(); } catch {}
  checkpointAndClose();
  process.exit(0);
}
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });

console.log(`
╔══════════════════════════════════════════════╗
║        BunBite - Image Optimizer          ║
║         Powered by Bun.Image API             ║
╠══════════════════════════════════════════════╣
║  http://localhost:${PORT}                      ║
╚══════════════════════════════════════════════╝
`);
