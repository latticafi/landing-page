import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

function createElement(textContent = "") {
  const attributes = new Map();
  const classes = new Set();
  const listeners = new Map();

  return {
    isConnected: true,
    style: {},
    textContent,
    classList: {
      add(name) {
        classes.add(name);
      },
      contains(name) {
        return classes.has(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        if (force === true) classes.add(name);
        else if (force === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      },
    },
    addEventListener(name, listener) {
      const handlers = listeners.get(name) || [];
      handlers.push(listener);
      listeners.set(name, handlers);
    },
    dispatch(name, event = {}) {
      for (const listener of listeners.get(name) || []) listener(event);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

test("runs the blog reveal under the same reduced-motion setting as the landing page", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const page = createElement();
  const title = createElement("Prediction Markets");
  const reveal = createElement();
  const anime = Object.assign(() => {}, { stagger: () => 0 });
  const document = {
    querySelector(selector) {
      return selector === '[data-page-kind="blog"]' ? page : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-blog-scramble]") return [title];
      return [reveal];
    },
  };
  const window = {
    anime,
    LatticaTextAnimations: {
      scrambleText: () => Promise.resolve(),
    },
    matchMedia: () => ({ matches: true }),
  };

  runInNewContext(script, { document, window });

  assert.equal(title.getAttribute("aria-label"), "Prediction Markets");
  assert.equal(reveal.style.opacity, "0");
});

test("keeps the blog navigation visible during the content reveal", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const page = createElement();
  const title = createElement("Prediction Markets");
  const nav = createElement();
  const reveal = createElement();
  const anime = Object.assign(() => {}, { stagger: () => 0 });
  const document = {
    querySelector(selector) {
      if (selector === '[data-page-kind="blog"]') return page;
      if (selector === ".site-nav") return nav;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-blog-scramble]") return [title];
      if (selector.includes(".blog-nav")) return [nav, reveal];
      return [reveal];
    },
    getElementById() {
      return null;
    },
    addEventListener() {},
  };
  const window = {
    anime,
    LatticaTextAnimations: {
      scrambleText: () => Promise.resolve(),
    },
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {}, matches: false }),
    scrollY: 0,
  };

  runInNewContext(script, { document, window });

  assert.equal(nav.style.opacity, undefined);
  assert.equal(reveal.style.opacity, "0");
});

test("toggles the landing-style mobile menu on blog pages", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const page = createElement();
  const title = createElement("Prediction Markets");
  const nav = createElement();
  const menuButton = createElement();
  const mobileMenu = createElement();
  const mobileLink = createElement();
  const documentEvents = createElement();
  const reveal = createElement();
  const anime = Object.assign(() => {}, { stagger: () => 0 });
  const document = {
    querySelector(selector) {
      if (selector === '[data-page-kind="blog"]') return page;
      if (selector === ".site-nav") return nav;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-blog-scramble]") return [title];
      if (selector === ".mobile-menu-item, .mobile-menu-x") {
        return [mobileLink];
      }
      return [reveal];
    },
    getElementById(id) {
      if (id === "nav-menu-btn") return menuButton;
      if (id === "mobile-menu") return mobileMenu;
      return null;
    },
    addEventListener: documentEvents.addEventListener,
    dispatch: documentEvents.dispatch,
  };
  const window = {
    anime,
    LatticaTextAnimations: {
      scrambleText: () => Promise.resolve(),
    },
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {}, matches: false }),
    scrollY: 0,
  };

  runInNewContext(script, { document, window });
  menuButton.dispatch("click", { stopPropagation() {} });

  assert.equal(mobileMenu.classList.contains("open"), true);
  assert.equal(menuButton.getAttribute("aria-expanded"), "true");

  document.dispatch("keydown", { key: "Escape" });

  assert.equal(mobileMenu.classList.contains("open"), false);
  assert.equal(menuButton.getAttribute("aria-expanded"), "false");
});

test("applies the landing navigation scroll state on blog pages", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const page = createElement();
  const title = createElement("Prediction Markets");
  const nav = createElement();
  const reveal = createElement();
  const windowListeners = new Map();
  const anime = Object.assign(() => {}, { stagger: () => 0 });
  const document = {
    querySelector(selector) {
      if (selector === '[data-page-kind="blog"]') return page;
      if (selector === ".site-nav") return nav;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-blog-scramble]") return [title];
      return [reveal];
    },
    getElementById() {
      return null;
    },
    addEventListener() {},
  };
  const window = {
    anime,
    LatticaTextAnimations: {
      scrambleText: () => Promise.resolve(),
    },
    addEventListener(name, listener) {
      windowListeners.set(name, listener);
    },
    matchMedia: () => ({ addEventListener() {}, matches: false }),
    scrollY: 0,
  };

  runInNewContext(script, { document, window });

  assert.equal(typeof windowListeners.get("scroll"), "function");
  window.scrollY = 25;
  windowListeners.get("scroll")();
  assert.equal(nav.classList.contains("scrolled"), true);
});

test("exposes an initializer for blog content inserted by the site router", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const document = {
    querySelector() {
      return null;
    },
  };
  const window = {};

  runInNewContext(script, { document, window });

  assert.equal(typeof window.LatticaBlogAnimations.init, "function");
});

test("replays the blog content animation whenever a cached page is reinserted", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const title = createElement("Prediction Markets");
  const reveal = createElement();
  const page = createElement();
  page.querySelectorAll = (selector) => {
    if (selector === "[data-blog-scramble]") return [title];
    if (selector === ".blog-eyebrow[data-blog-scramble]") return [];
    return [reveal];
  };
  const document = {
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-blog-scramble]") return [title];
      return [reveal];
    },
    getElementById() {
      return null;
    },
    addEventListener() {},
  };
  let scrambleCalls = 0;
  const window = {
    anime: Object.assign(() => {}, { stagger: () => 0 }),
    LatticaTextAnimations: {
      scrambleText: () => {
        scrambleCalls += 1;
        return Promise.resolve();
      },
    },
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {}, matches: false }),
    scrollY: 0,
  };

  runInNewContext(script, { document, window });
  window.LatticaBlogAnimations.init(page);
  window.LatticaBlogAnimations.init(page);

  assert.equal(scrambleCalls, 2);
});

test("unloads blog content in reverse without animating the navigation", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const title = createElement("Prediction Markets");
  const reveal = createElement();
  const nav = createElement();
  const page = createElement();
  page.querySelectorAll = (selector) => {
    if (selector === "[data-blog-scramble]") return [title];
    return [reveal];
  };
  const document = {
    querySelector(selector) {
      if (selector === ".site-nav") return nav;
      return null;
    },
  };
  const events = [];
  const anime = Object.assign(
    (options) => {
      events.push("fade");
      options.complete();
    },
    { stagger: () => 0 },
  );
  const window = {
    anime,
    LatticaTextAnimations: {
      scrambleText(element, text, duration, direction) {
        assert.equal(element, title);
        assert.equal(text, "Prediction Markets");
        assert.equal(direction, "out");
        events.push("scramble");
        return Promise.resolve();
      },
    },
    matchMedia: () => ({ matches: false }),
    setTimeout(callback, delay) {
      assert.equal(delay, 100);
      events.push("hold");
      callback();
    },
  };

  runInNewContext(script, { document, window });
  await window.LatticaBlogAnimations.exit?.(page);

  assert.deepEqual(events, ["fade", "scramble", "hold"]);
  assert.equal(nav.style.opacity, undefined);
});

test("runs the same unload effect as landing pages under reduced motion", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const title = createElement("Prediction Markets");
  const reveal = createElement();
  const page = createElement();
  page.querySelectorAll = (selector) => {
    if (selector === "[data-blog-scramble]") return [title];
    return [reveal];
  };
  const document = { querySelector: () => null };
  let animationCalls = 0;
  const window = {
    anime: Object.assign(
      (options) => {
        animationCalls += 1;
        options.complete();
      },
      { stagger: () => 0 },
    ),
    LatticaTextAnimations: {
      scrambleText: () => {
        animationCalls += 1;
        return Promise.resolve();
      },
    },
    matchMedia: () => ({ matches: true }),
  };

  runInNewContext(script, { document, window });
  await window.LatticaBlogAnimations.exit(page);

  assert.equal(animationCalls, 2);
});

test("allows navigation to continue if the blog unload effect fails", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const page = createElement();
  page.querySelectorAll = () => [createElement()];
  const document = { querySelector: () => null };
  const window = {
    anime: Object.assign(
      () => {
        throw new Error("animation unavailable");
      },
      { stagger: () => 0 },
    ),
    LatticaTextAnimations: {
      scrambleText: () => Promise.resolve(),
    },
    matchMedia: () => ({ matches: false }),
  };

  runInNewContext(script, { document, window });

  await assert.doesNotReject(() => window.LatticaBlogAnimations.exit(page));
});

test("does not reveal blog content after its unload has started", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const title = createElement("Prediction Markets");
  const reveal = createElement();
  const page = createElement();
  page.querySelectorAll = (selector) => {
    if (selector === "[data-blog-scramble]") return [title];
    if (selector === ".blog-eyebrow[data-blog-scramble]") return [];
    return [reveal];
  };
  const document = {
    querySelector() {
      return null;
    },
  };
  let finishLoad;
  let animeCalls = 0;
  const window = {
    anime: Object.assign(
      (options) => {
        animeCalls += 1;
        options.complete?.();
      },
      { stagger: () => 0 },
    ),
    LatticaTextAnimations: {
      scrambleText(element, text, duration, direction) {
        if (direction === "out") return Promise.resolve();
        return new Promise((resolve) => {
          finishLoad = resolve;
        });
      },
    },
    matchMedia: () => ({ matches: false }),
  };

  runInNewContext(script, { document, window });
  window.LatticaBlogAnimations.init(page);
  await window.LatticaBlogAnimations.exit(page);
  finishLoad();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(animeCalls, 1);
});

test("coalesces concurrent unload requests for the same blog page", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const page = createElement();
  page.querySelectorAll = () => [createElement()];
  const document = { querySelector: () => null };
  let finishFade;
  let fadeCalls = 0;
  const window = {
    anime: Object.assign(
      (options) => {
        fadeCalls += 1;
        finishFade = options.complete;
      },
      { stagger: () => 0 },
    ),
    LatticaTextAnimations: {
      scrambleText: () => Promise.resolve(),
    },
    matchMedia: () => ({ matches: false }),
  };

  runInNewContext(script, { document, window });
  const firstExit = window.LatticaBlogAnimations.exit(page);
  const secondExit = window.LatticaBlogAnimations.exit(page);

  assert.equal(fadeCalls, 1);
  finishFade();
  await Promise.all([firstExit, secondExit]);
});

test("defers reloading a blog page until its active unload finishes", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const title = createElement("Prediction Markets");
  const reveal = createElement();
  const page = createElement();
  page.querySelectorAll = (selector) => {
    if (selector === "[data-blog-scramble]") return [title];
    return [reveal];
  };
  const document = { querySelector: () => null };
  let finishFade;
  let loadCalls = 0;
  const window = {
    anime: Object.assign(
      (options) => {
        finishFade = options.complete;
      },
      { stagger: () => 0 },
    ),
    LatticaTextAnimations: {
      scrambleText(element, text, duration, direction) {
        if (direction === "in") loadCalls += 1;
        return Promise.resolve();
      },
    },
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {}, matches: false }),
    scrollY: 0,
  };

  runInNewContext(script, { document, window });
  const unloading = window.LatticaBlogAnimations.exit(page);
  window.LatticaBlogAnimations.init(page);

  assert.equal(loadCalls, 0);
  finishFade();
  await unloading;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadCalls, 1);
});

test("animates the blog eyebrow like the other landing section headers", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const eyebrow = createElement("BLOG");
  const title = createElement("Blog, News, and Articles");
  const support = createElement();
  const page = createElement();
  page.querySelectorAll = (selector) => {
    if (selector === "[data-blog-scramble]") return [eyebrow, title];
    if (selector === ".blog-eyebrow[data-blog-scramble]") return [eyebrow];
    return [support];
  };
  const document = { querySelector: () => null };
  const scrambleDurations = [];
  const animeTargets = [];
  const window = {
    anime: Object.assign(
      (options) => {
        animeTargets.push(options.targets);
        options.complete?.();
      },
      { stagger: () => 0 },
    ),
    LatticaTextAnimations: {
      scrambleText(element, text, duration) {
        scrambleDurations.push({ duration, text });
        return Promise.resolve();
      },
    },
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {}, matches: false }),
    scrollY: 0,
  };

  runInNewContext(script, { document, window });
  window.LatticaBlogAnimations.init(page);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(scrambleDurations, [
    { duration: 450, text: "BLOG" },
    { duration: 550, text: "Blog, News, and Articles" },
  ]);
  assert.equal(animeTargets[0][0], eyebrow);
});

test("delays the initial blog header animation to match landing-page headers", async () => {
  const script = await readFile(
    new URL("../public/assets/js/blog-animations.js", import.meta.url),
    "utf8",
  );
  const eyebrow = createElement("BLOG");
  const title = createElement("Blog, News, and Articles");
  const support = createElement();
  const page = createElement();
  const nav = createElement();
  page.querySelectorAll = (selector) => {
    if (selector === "[data-blog-scramble]") return [eyebrow, title];
    if (selector === ".blog-eyebrow[data-blog-scramble]") return [eyebrow];
    return [support];
  };
  const document = {
    querySelector(selector) {
      if (selector === '[data-page-kind="blog"]') return page;
      if (selector === ".site-nav") return nav;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    },
    addEventListener() {},
  };
  let scheduledCallback;
  let scheduledDelay;
  let scrambleCalls = 0;
  const window = {
    anime: Object.assign(() => {}, { stagger: () => 0 }),
    LatticaTextAnimations: {
      scrambleText() {
        scrambleCalls += 1;
        return Promise.resolve();
      },
    },
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {}, matches: false }),
    scrollY: 0,
    setTimeout(callback, delay) {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return 1;
    },
  };

  runInNewContext(script, { document, window });

  assert.equal(eyebrow.getAttribute("aria-label"), "BLOG");
  assert.equal(scrambleCalls, 0);
  assert.equal(scheduledDelay, 500);

  scheduledCallback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(scrambleCalls, 2);
});
