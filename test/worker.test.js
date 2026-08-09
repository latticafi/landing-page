import assert from "node:assert/strict";
import test from "node:test";

import app, { selectWorker, worker } from "../src/worker.js";

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
