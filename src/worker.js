// src/worker.js — Cloudflare Worker
//
// Handles:
//   POST /api/waitlist     → insert into D1 (after origin, rate-limit,
//                            and Turnstile checks; IP is HMAC-hashed)
//   anything else          → static asset from /public via the ASSETS binding
//
// Bindings (wrangler.toml):
//   - DB                 : D1 database
//   - ASSETS             : Static assets
//   - WAITLIST_LIMITER   : Rate-limit namespace (per-IP)
//
// Secrets (`wrangler secret put`):
//   - TURNSTILE_SECRET   : Cloudflare Turnstile secret key
//   - IP_SALT            : HMAC key used to hash IP addresses
//
// Vars (wrangler.toml):
//   - ALLOWED_ORIGINS    : comma-separated list of allowed Origin headers

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_BODY_BYTES = 2048;
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function checkOrigin(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.length) return true; // disabled if not configured
  const origin = request.headers.get("Origin");
  return !!origin && allowed.includes(origin);
}

async function verifyTurnstile(token, ip, secret) {
  if (!token || !secret) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form,
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("turnstile verify error:", err);
    return false;
  }
}

async function hmacIP(ip, salt) {
  if (!ip || !salt) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handleWaitlist(request, env) {
  // 1. Method
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // 2. Origin
  if (!checkOrigin(request, env)) {
    return json({ error: "forbidden_origin" }, 403);
  }

  // 3. Body size guard (cheap reject before parsing)
  const lenHeader = request.headers.get("Content-Length");
  if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
    return json({ error: "body_too_large" }, 413);
  }

  // 4. JSON parse
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // 5. Email
  const email = String(body?.email ?? "")
    .trim()
    .toLowerCase();
  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }

  // 6. Raw IP (used for rate-limit key + Turnstile siteverify; never persisted)
  const rawIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    null;

  // 7. Rate limit (per-IP per minute, scoped to one CF location)
  if (env.WAITLIST_LIMITER) {
    const { success } = await env.WAITLIST_LIMITER.limit({
      key: rawIP || "anonymous",
    });
    if (!success) return json({ error: "rate_limited" }, 429);
  }

  // 8. Turnstile
  if (!env.TURNSTILE_SECRET) {
    console.error("waitlist: TURNSTILE_SECRET not configured");
    return json({ error: "not_configured" }, 500);
  }
  const turnstileToken = String(body?.turnstileToken ?? "");
  if (!turnstileToken) {
    return json({ error: "missing_turnstile_token" }, 400);
  }
  const verified = await verifyTurnstile(
    turnstileToken,
    rawIP,
    env.TURNSTILE_SECRET,
  );
  if (!verified) return json({ error: "turnstile_failed" }, 403);

  // 9. Hash IP for storage
  if (!env.IP_SALT) {
    console.error("waitlist: IP_SALT not configured");
    return json({ error: "not_configured" }, 500);
  }
  const ipHash = await hmacIP(rawIP, env.IP_SALT);

  // 10. DB insert
  if (!env.DB) {
    console.error("waitlist: D1 binding 'DB' not configured");
    return json({ error: "not_configured" }, 500);
  }
  const ua = request.headers.get("User-Agent") || null;
  const ref = request.headers.get("Referer") || null;

  try {
    await env.DB.prepare(
      `INSERT INTO waitlist (email, ip_hash, user_agent, referrer)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO NOTHING`,
    )
      .bind(email, ipHash, ua, ref)
      .run();
    return json({ ok: true });
  } catch (err) {
    console.error("waitlist insert failed:", err);
    return json({ error: "db_error" }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/waitlist") {
      return handleWaitlist(request, env);
    }

    // Everything else: serve from /public via the assets binding.
    const response = await env.ASSETS.fetch(request);

    // For HTML responses, inject the Turnstile site key from env so
    // the key never lives in source. Streams through HTMLRewriter
    // with zero parsing overhead on non-HTML assets.
    const ct = response.headers.get("content-type") || "";
    if (env.TURNSTILE_SITE_KEY && ct.includes("text/html")) {
      return new HTMLRewriter()
        .on('meta[name="turnstile-site-key"]', {
          element(el) {
            el.setAttribute("content", env.TURNSTILE_SITE_KEY);
          },
        })
        .transform(response);
    }

    return response;
  },
};
