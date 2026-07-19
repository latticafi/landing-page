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
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function checkOrigin(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Origin checking is disabled when no allowlist is configured.
  if (!allowed.length) return true;

  const origin = request.headers.get("Origin");

  return Boolean(origin && allowed.includes(origin));
}

async function verifyTurnstile(token, ip, secret) {
  if (!token || !secret) {
    return {
      success: false,
      "error-codes": ["missing-input"],
    };
  }

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);

  if (ip) {
    form.append("remoteip", ip);
  }

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form,
    });

    let data;

    try {
      data = await res.json();
    } catch (err) {
      console.error("turnstile: invalid Siteverify response:", {
        httpStatus: res.status,
        error: String(err),
      });

      return {
        success: false,
        "error-codes": ["invalid-siteverify-response"],
        httpStatus: res.status,
      };
    }

    // Do not log the secret, raw token, email, or full IP address.
    console.log(
      "turnstile siteverify:",
      JSON.stringify({
        success: data.success === true,
        errorCodes: data["error-codes"] || [],
        hostname: data.hostname || null,
        action: data.action || null,
        cdata: data.cdata || null,
        challengeTs: data.challenge_ts || null,
        httpStatus: res.status,
      }),
    );

    if (!res.ok) {
      return {
        ...data,
        success: false,
        httpStatus: res.status,
      };
    }

    return data;
  } catch (err) {
    console.error("turnstile verify request failed:", err);

    return {
      success: false,
      "error-codes": ["siteverify-request-failed"],
    };
  }
}

async function hmacIP(ip, salt) {
  if (!ip || !salt) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function handleWaitlist(request, env) {
  // 1. Method
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // 2. Origin
  if (!checkOrigin(request, env)) {
    console.warn(
      "waitlist: forbidden origin",
      JSON.stringify({
        origin: request.headers.get("Origin"),
      }),
    );

    return json({ error: "forbidden_origin" }, 403);
  }

  // 3. Body size guard
  const contentLength = request.headers.get("Content-Length");

  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return json({ error: "body_too_large" }, 413);
  }

  // 4. Parse JSON
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // 5. Validate email
  const email = String(body?.email ?? "")
    .trim()
    .toLowerCase();

  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }

  // 6. Raw IP
  // Used for rate limiting and Turnstile verification, but never persisted.
  const rawIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    null;

  // 7. Rate limit
  if (env.WAITLIST_LIMITER) {
    const { success } = await env.WAITLIST_LIMITER.limit({
      key: rawIP || "anonymous",
    });

    if (!success) {
      console.warn("waitlist: rate limited");

      return json({ error: "rate_limited" }, 429);
    }
  }

  // 8. Turnstile
  if (!env.TURNSTILE_SECRET) {
    console.error("waitlist: TURNSTILE_SECRET not configured");

    return json({ error: "not_configured" }, 500);
  }

  const turnstileToken = String(body?.turnstileToken ?? "");

  if (!turnstileToken) {
    console.warn("waitlist: missing Turnstile token");

    return json(
      {
        error: "missing_turnstile_token",
      },
      400,
    );
  }

  const verification = await verifyTurnstile(
    turnstileToken,
    rawIP,
    env.TURNSTILE_SECRET,
  );

  if (verification.success !== true) {
    console.warn(
      "waitlist: Turnstile rejected submission",
      JSON.stringify({
        errorCodes: verification["error-codes"] || [],
        hostname: verification.hostname || null,
        action: verification.action || null,
        challengeTs: verification.challenge_ts || null,
        httpStatus: verification.httpStatus || null,
      }),
    );

    return json(
      {
        error: "turnstile_failed",

        // Useful while diagnosing the problem.
        // You can remove this field later if you do not want clients to see it.
        codes: verification["error-codes"] || [],
      },
      403,
    );
  }

  // 9. Hash IP for storage
  if (!env.IP_SALT) {
    console.error("waitlist: IP_SALT not configured");

    return json({ error: "not_configured" }, 500);
  }

  const ipHash = await hmacIP(rawIP, env.IP_SALT);

  // 10. Insert into D1
  if (!env.DB) {
    console.error("waitlist: D1 binding 'DB' not configured");

    return json({ error: "not_configured" }, 500);
  }

  const userAgent = request.headers.get("User-Agent") || null;
  const referrer = request.headers.get("Referer") || null;

  try {
    await env.DB.prepare(
      `INSERT INTO waitlist (email, ip_hash, user_agent, referrer)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO NOTHING`,
    )
      .bind(email, ipHash, userAgent, referrer)
      .run();

    return json({ ok: true });
  } catch (err) {
    console.error("waitlist insert failed:", err);

    return json({ error: "db_error" }, 500);
  }
}

// Canonical production origin, used for canonical + og:url regardless of
// whether the request arrived through the apex or www hostname.
const SITE_ORIGIN = "https://lattica.finance";

// Client-routed views that map to real URLs.
const ROUTES = {
  "/": {
    title: "Lattica — Leverage, Borrowing & Lending for Prediction Markets",
    description:
      "Lattica brings leverage, borrowing, and lending to prediction markets — trade the outcomes you want at up to 10x with the capital you need.",
    ogTitle: "Lattica — Prediction Markets at 10X",
    ogDescription:
      "Leverage, borrowing, and lending for prediction markets. Trade the markets you want with the capital you need.",
    canonical: "/",
  },

  "/whitepapers": {
    title: "Whitepapers",
    description: "Unlocking liquidity on prediction markets.",
    ogTitle: "Lattica — Whitepapers",
    ogDescription: "Unlocking liquidity on prediction markets.",
    canonical: "/",
  },

  "/waitlist": {
    title: "Join the Waitlist",
    description:
      "Get early access to leverage, borrowing, and lending for prediction markets.",
    ogTitle: "Lattica — Join the Waitlist",
    ogDescription:
      "Get early access to leverage, borrowing, and lending for prediction markets.",
    canonical: "/",
  },

  "/careers": {
    title: "Careers",
    description: "Careers at Lattica.",
    ogTitle: "Lattica — Careers",
    ogDescription: "Careers at Lattica.",
    canonical: "/",
  },
};

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

// Inject the Turnstile site key into HTML, along with route metadata.
function injectHtml(response, env, meta, canonical) {
  let rewriter = new HTMLRewriter().on('meta[name="turnstile-site-key"]', {
    element(element) {
      if (env.TURNSTILE_SITE_KEY) {
        element.setAttribute("content", env.TURNSTILE_SITE_KEY);
      }
    },
  });

  if (meta) {
    rewriter = rewriter
      .on("title", {
        element(element) {
          element.setInnerContent(meta.title);
        },
      })
      .on('meta[name="description"]', {
        element(element) {
          element.setAttribute("content", meta.description);
        },
      })
      .on('link[rel="canonical"]', {
        element(element) {
          element.setAttribute("href", canonical);
        },
      })
      .on('meta[property="og:title"]', {
        element(element) {
          element.setAttribute("content", meta.ogTitle);
        },
      })
      .on('meta[property="og:description"]', {
        element(element) {
          element.setAttribute("content", meta.ogDescription);
        },
      })
      .on('meta[property="og:url"]', {
        element(element) {
          element.setAttribute("content", canonical);
        },
      })
      .on('meta[name="twitter:title"]', {
        element(element) {
          element.setAttribute("content", meta.ogTitle);
        },
      })
      .on('meta[name="twitter:description"]', {
        element(element) {
          element.setAttribute("content", meta.ogDescription);
        },
      });
  }

  return rewriter.transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/waitlist") {
      return handleWaitlist(request, env);
    }

    // Client-routed SPA paths
    const path = normalizePath(url.pathname);
    const meta = ROUTES[path];

    if (meta) {
      const canonical =
        SITE_ORIGIN + (meta.canonical ?? (path === "/" ? "/" : path));

      const index = await env.ASSETS.fetch(new URL("/index.html", url.origin));

      return injectHtml(index, env, meta, canonical);
    }

    // Everything else: static asset from /public.
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";

    if (env.TURNSTILE_SITE_KEY && contentType.includes("text/html")) {
      return injectHtml(response, env, null, null);
    }

    return response;
  },
};
