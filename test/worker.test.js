import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import app, { selectWorker, worker } from "../src/worker.js";

async function getStructuredData() {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );

  const scripts = html.matchAll(
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g,
  );

  return [...scripts].map(([, json]) => JSON.parse(json));
}

test("serves requests without initializing Sentry when SENTRY_DSN is unset", async () => {
  const env = {
    ASSETS: {
      fetch() {
        return new Response("asset response");
      },
    },
  };

  assert.equal(selectWorker(env), worker);

  const response = await app.fetch(
    new Request("https://example.com/favicon.ico"),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset response");
});

test("offers only Lattica brand names to search engines", async () => {
  const structuredData = await getStructuredData();
  const website = structuredData.find((item) => item["@type"] === "WebSite");

  assert.equal(website.name, "Lattica");
  assert.deepEqual(website.alternateName, ["Lattica Finance"]);
});

test("links the organization schema to the canonical Lattica profile", async () => {
  const structuredData = await getStructuredData();
  const organization = structuredData.find(
    (item) => item["@type"] === "Organization",
  );

  assert.deepEqual(organization.sameAs, ["https://x.com/Lattica"]);
});
