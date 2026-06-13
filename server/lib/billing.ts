/**
 * BunBite — Stripe billing (test mode), zero external deps.
 * Uses the Stripe REST API over fetch and verifies webhooks with node:crypto HMAC.
 * Everything degrades gracefully: if STRIPE_* env is unset, billing endpoints return 503
 * and the app keeps working on the free tier.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureKeyForCheckout, setSubscriptionActive } from "./db";

const SECRET = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY || "";
const PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY || "";
const BASE = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

export function billingConfigured(): boolean { return !!SECRET && (!!PRICE_MONTHLY || !!PRICE_YEARLY) && !!BASE; }
export function webhookConfigured(): boolean { return !!WEBHOOK_SECRET; }

function priceFor(plan: string): string { return plan === "yearly" ? PRICE_YEARLY : PRICE_MONTHLY; }

async function stripe(path: string, method: "GET" | "POST", params?: Record<string, string>): Promise<any> {
  let url = "https://api.stripe.com" + path;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(SECRET + ":").toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (params) {
    const body = new URLSearchParams(params).toString();
    if (method === "GET") url += "?" + body; else init.body = body;
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

export async function createCheckoutSession(plan: string, email?: string): Promise<{ url: string }> {
  const price = priceFor(plan);
  if (!price) throw new Error("Unknown plan");
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${BASE}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE}/pricing.html`,
    allow_promotion_codes: "true",
    "metadata[plan]": plan,
    "subscription_data[metadata][plan]": plan,
  };
  if (email) params.customer_email = email;
  const session = await stripe("/v1/checkout/sessions", "POST", params);
  return { url: session.url as string };
}

/** Powers the success page: confirm the session is paid, then idempotently reveal its key. */
export async function retrieveSessionKey(sessionId: string): Promise<{ key: string; tier: string } | null> {
  const s = await stripe(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, "GET");
  const paid = s.payment_status === "paid" || s.status === "complete";
  if (!paid) return null;
  const key = ensureKeyForCheckout({
    sessionId: s.id,
    stripeCustomerId: typeof s.customer === "string" ? s.customer : s.customer?.id,
    email: s.customer_details?.email || s.customer_email,
    subscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id,
    plan: s.metadata?.plan,
  });
  return { key, tier: "pro" };
}

/** Verify a Stripe webhook signature against the raw body. Returns the parsed event or null. */
export function verifyWebhook(rawBody: string, sigHeader: string | null, toleranceSec = 300): any | null {
  if (!WEBHOOK_SECRET || !sigHeader) return null;
  const fields: Record<string, string> = {};
  for (const part of sigHeader.split(",")) {
    const idx = part.indexOf("=");
    if (idx > 0) fields[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  const t = fields.t, v1 = fields.v1;
  if (!t || !v1) return null;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return null;

  const expected = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}

/** Apply a verified event to the store. Unhandled types are a no-op (caller still returns 200). */
export function handleEvent(event: any): void {
  switch (event?.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      ensureKeyForCheckout({
        sessionId: s.id,
        stripeCustomerId: typeof s.customer === "string" ? s.customer : s.customer?.id,
        email: s.customer_details?.email || s.customer_email,
        subscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id,
        plan: s.metadata?.plan,
      });
      break;
    }
    case "customer.subscription.deleted":
      setSubscriptionActive(event.data.object.id, false);
      break;
    case "customer.subscription.updated": {
      const sub = event.data.object;
      setSubscriptionActive(sub.id, sub.status === "active" || sub.status === "trialing");
      break;
    }
    default:
      break; // ignore; Stripe still gets a 200
  }
}
