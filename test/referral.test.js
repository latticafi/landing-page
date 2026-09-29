import assert from "node:assert/strict";
import test from "node:test";

import app from "../src/worker.js";

const APP_ID = "Z7APZUZ7W5.com.lattica.lattica.beta";
const TESTFLIGHT_URL = "https://testflight.apple.com/join/gPSbYRtp";
const API_ORIGIN = "https://api.example";

function makeEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch() {
        return new Response("not found", { status: 404 });
      },
    },
    APPLE_APP_IDS: APP_ID,
    ...overrides,
  };
}

function get(path, env, origin = "https://lattica.finance") {
  return app.fetch(new Request(`${origin}${path}`), env);
}

// Runs `fn` with globalThis.fetch replaced, and restores it afterwards.
async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;

  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body, status = 200) {
  return () => new Response(JSON.stringify(body), { status });
}

const neverFetch = () => {
  throw new Error("fetch should not be called");
};

test("serves the Apple app-site-association from the Worker as JSON, on both hosts", async () => {
  for (const origin of ["https://lattica.finance", "https://www.lattica.finance"]) {
    const response = await get(
      "/.well-known/apple-app-site-association",
      makeEnv(),
      origin,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.match(response.headers.get("Cache-Control"), /max-age=/);
    assert.deepEqual(await response.json(), {
      applinks: {
        details: [
          {
            appIDs: [APP_ID],
            components: [{ "/": "/ref/*", comment: "Referral invite links" }],
          },
        ],
      },
    });
  }
});

test("lists every configured app id", async () => {
  const response = await get(
    "/.well-known/apple-app-site-association",
    makeEnv({ APPLE_APP_IDS: `${APP_ID}, Z7APZUZ7W5.com.lattica.lattica` }),
  );
  const body = await response.json();

  assert.deepEqual(body.applinks.details[0].appIDs, [
    APP_ID,
    "Z7APZUZ7W5.com.lattica.lattica",
  ]);
});

test("renders the invite page with the code and no lookup when API_ORIGIN is unset", async () => {
  const response = await withFetch(neverFetch, () =>
    get("/ref/abcd2345", makeEnv()),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^text\/html/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(html, /You&#039;re invited to <span class="bold">Lattica<\/span>/);
  assert.match(html, /<p class="invite-code">ABCD2345<\/p>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.doesNotMatch(html, /Get the app/);
});

test("names the referrer from the api and links to TestFlight", async () => {
  const calls = [];
  const stub = (url) => {
    calls.push(String(url));

    return jsonResponse({ handle: "ann_1" })();
  };

  const response = await withFetch(stub, () =>
    get("/ref/abcd2345/", makeEnv({ API_ORIGIN, TESTFLIGHT_URL })),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [`${API_ORIGIN}/referrals/codes/ABCD2345`]);
  assert.match(html, /<span class="bold">@ann_1<\/span> invited you to Lattica/);
  assert.match(html, /<p class="invite-code">ABCD2345<\/p>/);
  assert.match(
    html,
    /<a class="waitlist-submit invite-button" href="https:\/\/testflight\.apple\.com\/join\/gPSbYRtp">Get the app<\/a>/,
  );
});

test("answers 404 with an explanation when the api does not know the code", async () => {
  const response = await withFetch(
    jsonResponse({ statusCode: 404, code: "referral_code_unknown" }, 404),
    () => get("/ref/abcd2345", makeEnv({ API_ORIGIN, TESTFLIGHT_URL })),
  );
  const html = await response.text();

  assert.equal(response.status, 404);
  assert.match(html, /This invite link isn&#039;t valid/);
  assert.doesNotMatch(html, /ABCD2345/);
  assert.match(html, /Get the app/);
});

test("renders without a name when the api is down, slow, or answers nonsense", async () => {
  const stubs = [
    () => {
      throw new DOMException("aborted", "AbortError");
    },
    jsonResponse({ error: "boom" }, 500),
    () => new Response("<html>", { status: 200 }),
    jsonResponse({ handle: 42 }),
    jsonResponse({ handle: "Not A Handle" }),
  ];

  for (const stub of stubs) {
    const response = await withFetch(stub, () =>
      get("/ref/abcd2345", makeEnv({ API_ORIGIN })),
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /invited you/);
    assert.match(html, /<p class="invite-code">ABCD2345<\/p>/);
  }
});

test("escapes whatever the api or the config hands it", async () => {
  const response = await withFetch(
    jsonResponse({ handle: "ann_1" }),
    () =>
      get(
        "/ref/abcd2345",
        makeEnv({ API_ORIGIN, TESTFLIGHT_URL: `${TESTFLIGHT_URL}"><script>` }),
      ),
  );
  const html = await response.text();

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});

test("leaves anything that is not an 8-character code to the static assets", async () => {
  for (const path of ["/ref/", "/ref/not-a-code", "/ref/ABCD2345/x", "/ref/ABCD234", "/ref/ABCD0123"]) {
    const response = await withFetch(neverFetch, () =>
      get(path, makeEnv({ API_ORIGIN })),
    );

    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), "not found", path);
  }
});
