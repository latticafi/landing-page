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

// --- Referral invite links ---------------------------------------------------
// The mobile app shares https://lattica.finance/ref/<code>. With the app
// installed, iOS opens the link in the app straight away, thanks to the
// app-site-association file below; otherwise this page shows the code to
// type in and a button to install the app.

const AASA_PATH = "/.well-known/apple-app-site-association";
const REFERRAL_PREFIX = "/ref/";
// Same alphabet as the api: 8 uppercase characters without 0/O/1/I.
const REFERRAL_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const REFERRER_LOOKUP_TIMEOUT_MS = 1500;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function appleAppSiteAssociation(env) {
  const appIDs = (env.APPLE_APP_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const response = json({
    applinks: {
      details: [
        {
          appIDs,
          components: [
            { "/": `${REFERRAL_PREFIX}*`, comment: "Referral invite links" },
          ],
        },
      ],
    },
  });

  response.headers.set("Cache-Control", "public, max-age=3600");

  return response;
}

// The code owner's handle from the api: null when unknown or unreachable (the
// page still renders), "missing" when the api says the code does not exist.
async function referrerHandle(code, env) {
  if (!env.API_ORIGIN) return null;

  try {
    const response = await fetch(`${env.API_ORIGIN}/referrals/codes/${code}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REFERRER_LOOKUP_TIMEOUT_MS),
    });

    if (response.status === 404) return "missing";
    if (!response.ok) return null;

    const body = await response.json();
    const handle = body?.handle;

    return typeof handle === "string" && HANDLE_RE.test(handle) ? handle : null;
  } catch {
    return null;
  }
}

function invitePage({ code, handle, missing, testflightUrl }) {
  const title = missing
    ? "This invite link isn't valid"
    : "You're invited to Lattica";
  const description =
    "Trade sports with paper money at real prices. Open the invite in the Lattica app.";

  const headline = missing
    ? "This invite link isn&#039;t valid"
    : handle
      ? `<span class="bold">@${escapeHtml(handle)}</span> invited you to Lattica`
      : `You&#039;re invited to <span class="bold">Lattica</span>`;

  const details = missing
    ? `<p class="invite-hint">Check the link with whoever sent it, or get the app and start without a code.</p>`
    : `<p class="invite-code">${escapeHtml(code)}</p>
      <p class="invite-hint">Enter this code in the app if it did not open automatically.</p>`;

  const button = testflightUrl
    ? `<a class="waitlist-submit invite-button" href="${escapeHtml(testflightUrl)}">Get the app</a>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} — Lattica</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="#090909" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Lattica" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <style>html, body { background: #090909; color: transparent; } a { color: inherit; }</style>
    <link rel="stylesheet" href="/assets/css/styles.css" />
    <link rel="stylesheet" href="/assets/css/blog.css" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=Space+Mono:wght@400&display=swap" rel="stylesheet" />
    <style>
      .invite h1 { color: var(--white); }
      .invite-hint { margin-top: 18px; max-width: 420px; color: var(--silver); font-size: 15px; line-height: 1.5; }
      .invite-code { margin-top: 28px; font-family: var(--font-mono); font-size: 32px; letter-spacing: 0.28em; color: var(--white); user-select: all; }
      .invite-button { display: inline-block; margin-top: 36px; text-decoration: none; }
    </style>
  </head>
  <body>
    <main class="hero invite">
      <p class="blog-eyebrow">Referral</p>
      <h1>${headline}</h1>
      ${details}
      ${button}
    </main>
  </body>
</html>
`;
}

async function handleReferral(code, env) {
  const handle = await referrerHandle(code, env);
  const missing = handle === "missing";

  return new Response(
    invitePage({
      code,
      handle: missing ? null : handle,
      missing,
      testflightUrl: env.TESTFLIGHT_URL || null,
    }),
    {
      status: missing ? 404 : 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
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

    if (url.pathname === AASA_PATH) {
      return appleAppSiteAssociation(env);
    }

    const path = normalizePath(url.pathname);

    if (path.startsWith(REFERRAL_PREFIX)) {
      const code = path.slice(REFERRAL_PREFIX.length).toUpperCase();

      if (REFERRAL_CODE_RE.test(code)) {
        return handleReferral(code, env);
      }
    }

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
