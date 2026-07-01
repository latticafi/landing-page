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

// Canonical production origin, used for canonical + og:url regardless of
// whether the request arrived via the apex or www host.
const SITE_ORIGIN = "https://lattica.finance";

// Client-routed views that map to a real URL. The Worker serves index.html
// for each and rewrites its <head> so every route is a distinct, crawlable
// document with its own title/description/OG (JS-less scrapers included).
const ROUTES = {
  "/": {
    title: "Lattica",
    description: "Trade the markets you want with the capital you need.",
    ogTitle: "Lattica — Prediction Markets at 10X",
    ogDescription:
      "Leverage, borrowing, and lending for prediction markets. Trade the markets you want with the capital you need.",
  },
  "/whitepapers": {
    title: "Whitepapers — Lattica",
    description:
      "Research from Lattica: unlocking liquidity on prediction markets, and an introduction to the protocol.",
    ogTitle: "Whitepapers — Lattica",
    ogDescription:
      "Research from Lattica on bringing liquidity and leverage to prediction markets.",
  },
  "/waitlist": {
    title: "Join the Waitlist — Lattica",
    description:
      "Get early access to Lattica — leverage, borrowing, and lending for prediction markets.",
    ogTitle: "Join the Waitlist — Lattica",
    ogDescription:
      "Get early access to Lattica — leverage, borrowing, and lending for prediction markets.",
  },
  "/careers": {
    title: "Careers — Lattica",
    description: "Careers at Lattica. Check back soon.",
    ogTitle: "Careers — Lattica",
    ogDescription: "Careers at Lattica. Check back soon.",
  },
};

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

// Injects the Turnstile site key into any HTML, plus per-route <head>
// metadata when `meta`/`canonical` are supplied.
function injectHtml(response, env, meta, canonical) {
  let rw = new HTMLRewriter().on('meta[name="turnstile-site-key"]', {
    element(el) {
      if (env.TURNSTILE_SITE_KEY) {
        el.setAttribute("content", env.TURNSTILE_SITE_KEY);
      }
    },
  });
  if (meta) {
    rw = rw
      .on("title", {
        element(el) {
          el.setInnerContent(meta.title);
        },
      })
      .on('meta[name="description"]', {
        element(el) {
          el.setAttribute("content", meta.description);
        },
      })
      .on('link[rel="canonical"]', {
        element(el) {
          el.setAttribute("href", canonical);
        },
      })
      .on('meta[property="og:title"]', {
        element(el) {
          el.setAttribute("content", meta.ogTitle);
        },
      })
      .on('meta[property="og:description"]', {
        element(el) {
          el.setAttribute("content", meta.ogDescription);
        },
      })
      .on('meta[property="og:url"]', {
        element(el) {
          el.setAttribute("content", canonical);
        },
      })
      .on('meta[name="twitter:title"]', {
        element(el) {
          el.setAttribute("content", meta.ogTitle);
        },
      })
      .on('meta[name="twitter:description"]', {
        element(el) {
          el.setAttribute("content", meta.ogDescription);
        },
      });
  }
  return rw.transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/waitlist") {
      return handleWaitlist(request, env);
    }

    // Client-routed SPA paths: serve index.html with per-route metadata.
    const path = normalizePath(url.pathname);
    const meta = ROUTES[path];
    if (meta) {
      const canonical = SITE_ORIGIN + (path === "/" ? "/" : path);
      const index = await env.ASSETS.fetch(new URL("/index.html", url.origin));
      return injectHtml(index, env, meta, canonical);
    }

    // Everything else: static asset from /public via the assets binding.
    const response = await env.ASSETS.fetch(request);
    const ct = response.headers.get("content-type") || "";
    if (env.TURNSTILE_SITE_KEY && ct.includes("text/html")) {
      return injectHtml(response, env, null, null);
    }
    return response;
  },
};
