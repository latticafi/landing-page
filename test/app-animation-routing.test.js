import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

function createElement() {
  const classes = new Set();

  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle(name, force) {
        if (force === true) classes.add(name);
        else if (force === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      },
    },
    dataset: {},
    isConnected: true,
    style: {},
    textContent: "",
    value: "",
    addEventListener() {},
    focus() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    removeAttribute() {},
    setAttribute() {},
  };
}

async function loadLandingApp() {
  const script = await readFile(
    new URL("../public/assets/js/app.js", import.meta.url),
    "utf8",
  );
  const elements = new Map();
  const landingRoot = createElement();
  const nav = createElement();
  const scheduled = [];
  const cancellations = [];
  const requiredIds = new Set([
    "careers-back",
    "careers-btn",
    "careers-eyebrow",
    "careers-title",
    "careers-view",
    "hero-cta",
    "hero-h1",
    "hero-sub",
    "home-btn",
    "logo-btn",
    "mobile-menu",
    "nav-menu-btn",
    "paper-divider",
    "paper-num-1",
    "paper-num-2",
    "paper-title-1",
    "paper-title-2",
    "papers-back",
    "papers-view",
    "role-divider",
    "role-title-1",
    "role-title-2",
    "waitlist-back",
    "waitlist-btn",
    "waitlist-eyebrow",
    "waitlist-form",
    "waitlist-input",
    "waitlist-status",
    "waitlist-submit",
    "waitlist-title",
    "waitlist-view",
    "whitepapers-btn",
  ]);
  const getElement = (id) => {
    if (!requiredIds.has(id)) return null;
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const document = {
    body: createElement(),
    addEventListener() {},
    getElementById: getElement,
    querySelector(selector) {
      if (selector === '[data-page-kind="landing"]') return landingRoot;
      if (selector === "nav") return nav;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    removeEventListener() {},
  };
  const history = {
    pushState() {},
    replaceState() {},
    scrollRestoration: "auto",
  };
  const anime = Object.assign(() => {}, {
    stagger: () => 0,
    timeline() {
      const timeline = {
        add() {
          return timeline;
        },
      };
      return timeline;
    },
  });
  const window = {
    LatticeBG: { intro: {} },
    LatticaTextAnimations: {
      cancelTextAnimation(element) {
        cancellations.push(element);
      },
      scrambleHeroTwoTone() {
        return new Promise(() => {});
      },
      scrambleText() {
        return Promise.resolve();
      },
    },
    addEventListener() {},
    anime,
    history,
    location: { pathname: "/" },
    matchMedia: () => ({ addEventListener() {} }),
    scrollTo() {},
  };
  const setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };

  runInNewContext(script, {
    anime,
    clearInterval() {},
    clearTimeout() {},
    document,
    fetch() {},
    history,
    setInterval() {},
    setTimeout,
    window,
  });

  scheduled.find(({ delay }) => delay === 500).callback();
  await Promise.resolve();

  return { cancellations, landingRoot, window };
}

test("keeps ordinary landing-page animations serialized", async () => {
  const { cancellations, window } = await loadLandingApp();

  window.LatticaLandingNavigate("/careers", { push: false });

  assert.equal(cancellations.length, 0);
});

test("interrupts an active landing animation only when leaving for another page system", async () => {
  const { cancellations, landingRoot, window } = await loadLandingApp();

  window.LatticaLandingExit(landingRoot);

  assert.ok(cancellations.length > 0);
});
