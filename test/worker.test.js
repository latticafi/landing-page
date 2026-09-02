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

test("links desktop and mobile navigation to the blog", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const blogLinks = [...html.matchAll(/href="\/blog\/"/g)];

  assert.equal(blogLinks.length, 2);
});

test("loads the shared text animation before the landing app", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const sharedAnimation = html.indexOf('/assets/js/text-scramble.js');
  const landingApp = html.indexOf('/assets/js/app.js');

  assert.ok(sharedAnimation >= 0);
  assert.ok(sharedAnimation < landingApp);
});

test("provides a persistent shell around landing content", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /data-page-content[^>]*data-page-kind="landing"/);
  assert.match(html, /<a class="logo" id="logo-btn" href="\/"/);
  assert.match(html, /<a class="nav-text-btn" id="home-btn" href="\/"/);
  assert.match(html, /href="\/assets\/css\/blog\.css"/);
  assert.ok(
    html.indexOf('/assets/js/app.js') <
      html.indexOf('/assets/js/site-router.js'),
  );
  assert.ok(
    html.indexOf('/assets/js/blog-animations.js') <
      html.indexOf('/assets/js/site-router.js'),
  );
});

test("keeps landing text unpainted before its stylesheet loads", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const firstStylesheet = html.indexOf('<link rel="stylesheet"');
  const criticalStyles = html.slice(0, firstStylesheet);

  assert.match(
    criticalStyles,
    /html,\s*body\s*{[^}]*color:\s*transparent;/s,
  );
  assert.match(criticalStyles, /a\s*{[^}]*color:\s*inherit;/s);
});

test("links each careers role to its Dover application", async () => {
  const html = await readFile(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const careersStart = html.indexOf('<div class="careers-view"');
  const careersEnd = html.indexOf("</section>", careersStart);
  const careers = html.slice(careersStart, careersEnd);

  assert.match(
    careers,
    /href="https:\/\/app\.dover\.com\/apply\/Lattica\/b395c331-c695-4140-bef6-fa555c8cd182\/\?rs=76643084"[^>]*>[\s\S]*Full Stack Engineer/,
  );
  assert.match(
    careers,
    /href="https:\/\/app\.dover\.com\/apply\/Lattica\/e05cf450-fed5-4ad9-9711-5a63440b9af1\/\?rs=76643084"[^>]*>[\s\S]*Product Designer/,
  );
  assert.equal((careers.match(/target="_blank"/g) || []).length, 2);
  assert.equal((careers.match(/rel="noopener"/g) || []).length, 2);
});
