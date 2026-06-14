import { optimizeImage, optimizeBatch } from "./lib/optimizer";
import { resolveAccess, check, increment, getRemaining } from "./lib/ratelimit";
import { touchApiKey } from "./lib/db";
import {
  billingConfigured, webhookConfigured, createCheckoutSession,
  retrieveSessionKey, verifyWebhook, handleEvent,
} from "./lib/billing";

const PORT = Number(process.env.PORT) || 3000;

function getClientIP(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "127.0.0.1";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  maxRequestBodySize: 100 * 1024 * 1024,

  async fetch(req) {
    const url = new URL(req.url);
    const ip = getClientIP(req);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
        },
      });
    }

    if (url.pathname === "/api/optimize" && req.method === "POST") {
      return handleOptimize(req, ip);
    }
    if (url.pathname === "/api/batch" && req.method === "POST") {
      return handleBatch(req, ip);
    }
    if (url.pathname === "/api/status" && req.method === "GET") {
      return handleStatus(ip, req);
    }
    if (url.pathname === "/api/health") {
      return json({ status: "ok", engine: "bun-image", version: "1.0.0" });
    }
    if (url.pathname === "/api/config" && req.method === "GET") {
      return json({ billing: billingConfigured() });
    }
    if (url.pathname === "/api/checkout" && req.method === "POST") {
      return handleCheckout(req);
    }
    if (url.pathname === "/api/checkout/session" && req.method === "GET") {
      return handleSessionLookup(url);
    }
    if (url.pathname === "/api/stripe/webhook" && req.method === "POST") {
      return handleWebhook(req);
    }

    return serveStatic(url.pathname);
  },
});

async function handleOptimize(req: Request, ip: string): Promise<Response> {
  const apiKey = req.headers.get("x-api-key") || undefined;
  const { tier, config, subject } = resolveAccess(apiKey, ip);
  const limit = check(subject, config);

  if (!limit.allowed) {
    return err(`Rate limit exceeded. Resets at ${limit.resetAt}.`, 429);
  }

  // Reject oversized uploads before buffering the body (memory/DoS guard).
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength && contentLength > config.maxFileSizeBytes + 1_048_576) {
    return err(`File too large. Max ${(config.maxFileSizeBytes / 1048576).toFixed(0)}MB.`, 413);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) return err("No image file provided.");
    if (file.size > config.maxFileSizeBytes) {
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
      return err("Invalid format. Use: jpeg, png, or webp");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await optimizeImage(buffer, {
      format: format as "jpeg" | "png" | "webp",
      quality, width, height, fit, withoutEnlargement, progressive,
    });

    increment(subject);
    if (tier === "pro" && apiKey) touchApiKey(apiKey);

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
    console.error("Optimize error:", e);
    return err(e.message || "Internal error", 500);
  }
}

async function handleBatch(req: Request, ip: string): Promise<Response> {
  const apiKey = req.headers.get("x-api-key") || undefined;
  const { tier, config, subject } = resolveAccess(apiKey, ip);
  if (!config.batchEnabled) return err("Batch requires Pro tier.", 403);

  const limit = check(subject, config);
  if (!limit.allowed) return err(`Rate limit exceeded. Resets at ${limit.resetAt}.`, 429);

  // Reject oversized batch payloads before buffering (memory/DoS guard).
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength && contentLength > config.maxFileSizeBytes * config.maxBatchSize + 1_048_576) {
    return err("Batch payload too large.", 413);
  }

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

    const { results, errors } = await optimizeBatch(files, { format, quality, width, height }, config.maxBatchSize);
    for (let i = 0; i < results.length; i++) increment(subject);
    if (tier === "pro" && apiKey) touchApiKey(apiKey);

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
  }
}

function handleStatus(ip: string, req: Request): Response {
  const apiKey = req.headers.get("x-api-key") || undefined;
  const { tier, config, subject } = resolveAccess(apiKey, ip);
  return json({
    tier,
    remaining: getRemaining(subject, config),
    limit: config.maxRequestsPerDay,
    maxFileSizeMB: config.maxFileSizeBytes / 1048576,
    batchEnabled: config.batchEnabled,
    maxBatchSize: config.maxBatchSize,
    engine: "bun-image",
  });
}

async function handleCheckout(req: Request): Promise<Response> {
  if (!billingConfigured()) return err("Billing is not configured yet.", 503);
  try {
    const body = (await req.json().catch(() => ({}))) as { plan?: string; email?: string };
    const plan = body.plan === "yearly" ? "yearly" : "monthly";
    const email = typeof body.email === "string" && body.email ? body.email : undefined;
    const { url } = await createCheckoutSession(plan, email);
    return json({ url });
  } catch (e: any) {
    return err(e.message || "Checkout failed", 500);
  }
}

async function handleSessionLookup(url: URL): Promise<Response> {
  if (!billingConfigured()) return err("Billing is not configured yet.", 503);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return err("Missing session_id");
  try {
    const result = await retrieveSessionKey(sessionId);
    if (!result) return json({ status: "pending" }, 202);
    return json({ status: "paid", key: result.key, tier: result.tier });
  } catch (e: any) {
    return err(e.message || "Lookup failed", 500);
  }
}

async function handleWebhook(req: Request): Promise<Response> {
  if (!webhookConfigured()) return new Response("not configured", { status: 503 });
  const raw = await req.text(); // exact raw body required for signature verification
  const event = verifyWebhook(raw, req.headers.get("stripe-signature"));
  if (!event) return new Response("invalid signature", { status: 400 });
  try { handleEvent(event); } catch (e) { console.error("Webhook handling error:", e); }
  return new Response("ok", { status: 200 }); // 200 even for unhandled types so Stripe stops retrying
}

async function serveStatic(pathname: string): Promise<Response> {
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const filePath = `./public${pathname}`;
  const file = Bun.file(filePath);

  if (await file.exists()) {
    const ext = pathname.split(".").pop() || "";
    const mimes: Record<string, string> = {
      html: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
      js: "application/javascript; charset=utf-8", json: "application/json",
      png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml",
      ico: "image/x-icon", woff2: "font/woff2",
    };
    return new Response(file, {
      headers: {
        "Content-Type": mimes[ext] || "application/octet-stream",
        "Cache-Control": ext === "html" ? "no-cache" : "public, max-age=86400",
      },
    });
  }

  const idx = Bun.file("./public/index.html");
  if (await idx.exists()) return new Response(idx, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new Response("Not Found", { status: 404 });
}

console.log(`
╔══════════════════════════════════════════════╗
║        BunBite - Image Optimizer          ║
║         Powered by Bun.Image API             ║
╠══════════════════════════════════════════════╣
║  http://localhost:${PORT}                      ║
╚══════════════════════════════════════════════╝
`);
