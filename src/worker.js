import { withSentry } from "@sentry/cloudflare";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_BODY_BYTES = 2048;

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
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!checkOrigin(request, env)) {
    console.warn(
      "waitlist: forbidden origin",
      JSON.stringify({
        origin: request.headers.get("Origin"),
      }),
    );

    return json({ error: "forbidden_origin" }, 403);
  }

  const contentLength = request.headers.get("Content-Length");

  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return json({ error: "body_too_large" }, 413);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = String(body?.email ?? "")
    .trim()
    .toLowerCase();

  if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email" }, 400);
  }

  // Raw IP is used for rate limiting but never persisted.
  const rawIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    null;

  if (env.WAITLIST_LIMITER) {
    const { success } = await env.WAITLIST_LIMITER.limit({
      key: rawIP || "anonymous",
    });

    if (!success) {
      console.warn("waitlist: rate limited");

      return json({ error: "rate_limited" }, 429);
    }
  }

  if (!env.IP_SALT) {
    console.error("waitlist: IP_SALT not configured");

    return json({ error: "not_configured" }, 500);
  }

  const ipHash = await hmacIP(rawIP, env.IP_SALT);

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

// Canonical metadata always points at the apex domain.
const SITE_ORIGIN = "https://lattica.finance";

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

function injectHtml(response, meta, canonical) {
  return new HTMLRewriter()
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
    })
    .transform(response);
}

export const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === "/api/debug/sentry" &&
      env.SENTRY_DEBUG_ENABLED === "true"
    ) {
      throw new Error("Sentry verification error");
    }

    if (url.pathname === "/api/waitlist") {
      return handleWaitlist(request, env);
    }

    const path = normalizePath(url.pathname);
    const meta = ROUTES[path];

    if (meta) {
      const canonical =
        SITE_ORIGIN + (meta.canonical ?? (path === "/" ? "/" : path));

      const index = await env.ASSETS.fetch(new URL("/index.html", url.origin));

      return injectHtml(index, meta, canonical);
    }

    return env.ASSETS.fetch(request);
  },
};

const sentryWorker = withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    enableLogs: true,
  }),
  { ...worker },
);

export function selectWorker(env) {
  return env.SENTRY_DSN ? sentryWorker : worker;
}

export default {
  fetch(request, env, ctx) {
    return selectWorker(env).fetch(request, env, ctx);
  },
};
