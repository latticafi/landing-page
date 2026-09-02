import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

async function loadRouterApi() {
  const script = await readFile(
    new URL("../public/assets/js/site-router.js", import.meta.url),
    "utf8",
  );
  const window = {};

  runInNewContext(script, { URL, window });

  return window.LatticaSiteRouter;
}

function createRoot(name) {
  return {
    dataset: {},
    name,
    replaceWith(nextRoot) {
      this.replacedWith = nextRoot;
    },
  };
}

function createPhasedClickTarget() {
  const captureListeners = [];
  const bubbleListeners = [];

  return {
    addEventListener(name, listener, options) {
      if (name !== "click") return;
      if (options === true || options?.capture) captureListeners.push(listener);
      else bubbleListeners.push(listener);
    },
    async dispatchClick(event, targetListener) {
      const pending = [];

      for (const listener of captureListeners) pending.push(listener(event));
      if (!event.propagationStopped) targetListener(event);
      if (!event.propagationStopped) {
        for (const listener of bubbleListeners) pending.push(listener(event));
      }

      await Promise.all(pending);
    },
  };
}

function createEventTarget() {
  const listeners = new Map();

  return {
    addEventListener(name, listener) {
      const handlers = listeners.get(name) || [];
      handlers.push(listener);
      listeners.set(name, handlers);
    },
    async dispatch(name, event) {
      for (const listener of listeners.get(name) || []) await listener(event);
    },
  };
}

test("replaces only page content and preserves the existing navigation", async () => {
  const api = await loadRouterApi();
  const navigation = { name: "persistent-navigation" };
  const currentRoot = createRoot("home");
  const nextRoot = createRoot("blog");
  const historyCalls = [];
  const document = {
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "nav") return navigation;
      if (selector === "[data-page-content]") return currentRoot;
      return null;
    },
  };
  const window = {
    history: {
      pushState(state, unused, url) {
        historyCalls.push({ state, url });
      },
    },
    location: {
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "blog-page",
      metadata: { title: "Blog — Lattica" },
      root: nextRoot,
    }),
  });

  await router.navigate("https://lattica.finance/blog/");

  assert.equal(document.querySelector("nav"), navigation);
  assert.equal(currentRoot.replacedWith, nextRoot);
  assert.equal(document.body.className, "blog-page");
  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0].state.path, "/blog/");
  assert.equal(historyCalls[0].url, "/blog/");
});

test("does not push history or replay when navigating to the active route", async () => {
  const api = await loadRouterApi();
  const currentRoot = createRoot("blog");
  currentRoot.dataset.pageKind = "blog";
  let historyPushes = 0;
  let animations = 0;
  const document = {
    body: { className: "blog-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return currentRoot;
      if (selector.startsWith("script[src=")) return {};
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history: {
      pushState() {
        historyPushes += 1;
      },
    },
    LatticaBlogAnimations: {
      init() {
        animations += 1;
      },
    },
    location: {
      assign() {},
      href: "https://lattica.finance/blog/",
      origin: "https://lattica.finance",
      pathname: "/blog/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => {
      throw new Error("active route must not load");
    },
  });

  const result = await router.navigate("https://lattica.finance/blog/");

  assert.equal(result, true);
  assert.equal(historyPushes, 0);
  assert.equal(animations, 0);
});

test("cancels an in-flight page change when the active route is requested again", async () => {
  const api = await loadRouterApi();
  const events = [];
  const landingRoot = createRoot("home");
  const blogRoot = createRoot("blog");
  landingRoot.dataset.pageKind = "landing";
  blogRoot.dataset.pageKind = "blog";
  landingRoot.replaceWith = () => events.push("insert-blog");
  let finishExit;
  const document = {
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return landingRoot;
      if (selector.startsWith("script[src=")) return {};
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history: { pushState() {} },
    LatticaBlogAnimations: { init() {}, prepare() {} },
    LatticaLandingExit() {
      events.push("exit-home");
      return new Promise((resolve) => {
        finishExit = resolve;
      });
    },
    LatticaLandingNavigate(pathname) {
      events.push(`activate-${pathname}`);
    },
    location: {
      assign() {},
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "blog-page",
      metadata: { title: "Blog — Lattica" },
      root: blogRoot,
    }),
  });

  const blogNavigation = router.navigate("https://lattica.finance/blog/");
  await new Promise((resolve) => setImmediate(resolve));
  const homeNavigation = router.navigate("https://lattica.finance/");
  await new Promise((resolve) => setImmediate(resolve));

  finishExit();
  const [blogResult, homeResult] = await Promise.all([
    blogNavigation,
    homeNavigation,
  ]);

  assert.equal(blogResult, false);
  assert.equal(homeResult, true);
  assert.equal(events.includes("insert-blog"), false);
  assert.equal(events.includes("activate-/"), true);
});

test("reactivates the requested route when browser history diverges from router state", async () => {
  const api = await loadRouterApi();
  const landingRoot = createRoot("landing");
  landingRoot.dataset.pageKind = "landing";
  const activations = [];
  const document = {
    body: { className: "landing-page modal-view" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return landingRoot;
      if (selector.startsWith("script[src=")) return {};
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history: { pushState() {} },
    LatticaLandingNavigate(pathname) {
      activations.push(pathname);
    },
    location: {
      assign() {},
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({ document, window });

  window.location.href = "https://lattica.finance/waitlist";
  window.location.pathname = "/waitlist";
  await router.navigate("https://lattica.finance/");

  assert.deepEqual(activations, ["/"]);
});

test("falls back to a document navigation when loading page content fails", async () => {
  const api = await loadRouterApi();
  const assigned = [];
  const document = {
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return createRoot("home");
      return null;
    },
  };
  const window = {
    history: { pushState() {} },
    location: {
      assign(url) {
        assigned.push(url);
      },
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => {
      throw new Error("network unavailable");
    },
  });

  await router.navigate("https://lattica.finance/blog/");

  assert.deepEqual(assigned, ["https://lattica.finance/blog/"]);
});

test("intercepts an unmodified same-origin link click", async () => {
  const api = await loadRouterApi();
  const documentEvents = createEventTarget();
  const currentRoot = createRoot("home");
  const nextRoot = createRoot("blog");
  const document = {
    ...documentEvents,
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return currentRoot;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const windowEvents = createEventTarget();
  const window = {
    ...windowEvents,
    history: { pushState() {} },
    location: {
      assign() {},
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const loadedUrls = [];
  const router = api.createRouter({
    document,
    window,
    loadPage: async (url) => {
      loadedUrls.push(url);
      return {
        bodyClass: "blog-page",
        metadata: { title: "Blog — Lattica" },
        root: nextRoot,
      };
    },
  });
  const link = {
    href: "https://lattica.finance/blog/",
    origin: "https://lattica.finance",
    target: "",
    closest(selector) {
      return selector === "a[href]" ? this : null;
    },
    hasAttribute() {
      return false;
    },
  };
  const event = {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    shiftKey: false,
    target: link,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  router.start();
  await document.dispatch("click", event);

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(loadedUrls, ["https://lattica.finance/blog/"]);
  assert.equal(currentRoot.replacedWith, nextRoot);
});

test("uses client navigation for browser back and forward without pushing history", async () => {
  const api = await loadRouterApi();
  const documentEvents = createEventTarget();
  const windowEvents = createEventTarget();
  const currentRoot = createRoot("blog");
  const nextRoot = createRoot("home");
  let historyPushes = 0;
  const document = {
    ...documentEvents,
    body: { className: "blog-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return currentRoot;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    ...windowEvents,
    history: {
      pushState() {
        historyPushes += 1;
      },
    },
    location: {
      assign() {},
      href: "https://lattica.finance/blog/",
      origin: "https://lattica.finance",
      pathname: "/blog/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "landing-page",
      metadata: { title: "Lattica" },
      root: nextRoot,
    }),
  });

  router.start();
  window.location.href = "https://lattica.finance/";
  window.location.pathname = "/";
  await window.dispatch("popstate", {});

  assert.equal(historyPushes, 0);
  assert.equal(currentRoot.replacedWith, nextRoot);
});

test("updates canonical metadata after a page swap", async () => {
  const api = await loadRouterApi();
  const currentRoot = createRoot("home");
  const nextRoot = createRoot("article");
  const canonical = {
    getAttribute() {
      return "https://lattica.finance/";
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  const document = {
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return currentRoot;
      if (selector === 'link[rel="canonical"]') return canonical;
      return null;
    },
  };
  const window = {
    history: { pushState() {} },
    location: {
      assign() {},
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "article-page",
      metadata: {
        canonical: "https://lattica.finance/blog/article/",
        title: "Article — Lattica",
      },
      root: nextRoot,
    }),
  });

  await router.navigate("https://lattica.finance/blog/article/");

  assert.equal(document.title, "Article — Lattica");
  assert.equal(canonical.href, "https://lattica.finance/blog/article/");
});

test("persistent navigation wins over a landing-page click handler", async () => {
  const api = await loadRouterApi();
  const documentEvents = createPhasedClickTarget();
  const currentRoot = createRoot("home");
  const nextRoot = createRoot("blog");
  const document = {
    ...documentEvents,
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return currentRoot;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    ...createEventTarget(),
    history: { pushState() {} },
    location: {
      assign() {},
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "blog-page",
      metadata: { title: "Blog — Lattica" },
      root: nextRoot,
    }),
  });
  const nav = {};
  const link = {
    href: "https://lattica.finance/blog/",
    target: "",
    closest(selector) {
      if (selector === "a[href]") return this;
      if (selector === ".site-nav, .mobile-menu") return nav;
      return null;
    },
    hasAttribute() {
      return false;
    },
  };
  const event = {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    propagationStopped: false,
    shiftKey: false,
    target: link,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
  let landingHandlerCalls = 0;

  router.start();
  await document.dispatchClick(event, (clickEvent) => {
    landingHandlerCalls += 1;
    clickEvent.preventDefault();
  });

  assert.equal(landingHandlerCalls, 0);
  assert.equal(currentRoot.replacedWith, nextRoot);
});

test("persistent mobile navigation closes the menu before changing pages", async () => {
  const api = await loadRouterApi();
  const documentEvents = createPhasedClickTarget();
  const currentRoot = createRoot("blog");
  const nextRoot = createRoot("home");
  const menuClasses = new Set(["open"]);
  const buttonClasses = new Set(["is-open"]);
  const mobileMenu = {
    classList: { remove: (name) => menuClasses.delete(name) },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  const menuButton = {
    classList: { remove: (name) => buttonClasses.delete(name) },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  const document = {
    ...documentEvents,
    body: { className: "blog-page" },
    getElementById(id) {
      if (id === "mobile-menu") return mobileMenu;
      if (id === "nav-menu-btn") return menuButton;
      return null;
    },
    querySelector(selector) {
      if (selector === "[data-page-content]") return currentRoot;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    ...createEventTarget(),
    history: { pushState() {} },
    location: {
      assign() {},
      href: "https://lattica.finance/blog/",
      origin: "https://lattica.finance",
      pathname: "/blog/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "landing-page",
      metadata: { title: "Lattica" },
      root: nextRoot,
    }),
  });
  const link = {
    href: "https://lattica.finance/",
    target: "",
    closest(selector) {
      if (selector === "a[href]") return this;
      if (selector === ".site-nav, .mobile-menu") return mobileMenu;
      return null;
    },
    hasAttribute() {
      return false;
    },
  };
  const event = {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    propagationStopped: false,
    shiftKey: false,
    target: link,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };

  router.start();
  await document.dispatchClick(event, () => {});

  assert.equal(menuClasses.has("open"), false);
  assert.equal(buttonClasses.has("is-open"), false);
  assert.equal(mobileMenu["aria-hidden"], "true");
  assert.equal(menuButton["aria-expanded"], "false");
  assert.equal(menuButton["aria-label"], "Open menu");
});

test("prepares incoming blog content before inserting it", async () => {
  const api = await loadRouterApi();
  const events = [];
  const currentRoot = createRoot("home");
  const nextRoot = createRoot("blog");
  nextRoot.dataset.pageKind = "blog";
  currentRoot.replaceWith = () => events.push("insert");
  const document = {
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return currentRoot;
      if (selector === 'script[src="/assets/js/blog-animations.js"]') return {};
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history: { pushState() {} },
    LatticaBlogAnimations: {
      prepare(root) {
        assert.equal(root, nextRoot);
        events.push("prepare");
      },
      init(root) {
        assert.equal(root, nextRoot);
        events.push("animate");
      },
    },
    location: {
      assign() {},
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "blog-page",
      metadata: { title: "Blog — Lattica" },
      root: nextRoot,
    }),
  });

  await router.navigate("https://lattica.finance/blog/");

  assert.deepEqual(events, ["prepare", "insert", "animate"]);
});

test("replays landing content after returning from the blog", async () => {
  const api = await loadRouterApi();
  const landingRoot = createRoot("home");
  const blogRoot = createRoot("blog");
  landingRoot.dataset.pageKind = "landing";
  blogRoot.dataset.pageKind = "blog";
  const landingActivations = [];
  const document = {
    body: { className: "landing-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return landingRoot;
      if (selector.startsWith("script[src=")) return {};
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history: { pushState() {} },
    LatticaBlogAnimations: { init() {}, prepare() {} },
    LatticaLandingNavigate(pathname, options) {
      landingActivations.push({ options, pathname });
    },
    location: {
      assign() {},
      href: "https://lattica.finance/",
      origin: "https://lattica.finance",
      pathname: "/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async (url) => {
      assert.equal(new URL(url).pathname, "/blog/");
      return {
        bodyClass: "blog-page",
        metadata: { title: "Blog — Lattica" },
        root: blogRoot,
      };
    },
  });

  await router.navigate("https://lattica.finance/blog/");
  await router.navigate("https://lattica.finance/");

  assert.equal(landingActivations.length, 1);
  assert.equal(landingActivations[0].pathname, "/");
  assert.equal(landingActivations[0].options.push, false);
  assert.equal(landingActivations[0].options.replay, true);
});

test("waits for the blog unload animation before inserting the destination", async () => {
  const api = await loadRouterApi();
  const events = [];
  const blogRoot = createRoot("blog");
  const landingRoot = createRoot("home");
  blogRoot.dataset.pageKind = "blog";
  landingRoot.dataset.pageKind = "landing";
  blogRoot.replaceWith = () => events.push("insert");
  let finishExit;
  const document = {
    body: { className: "blog-page" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return blogRoot;
      if (selector.startsWith("script[src=")) return {};
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history: { pushState() {} },
    LatticaBlogAnimations: {
      exit(root) {
        assert.equal(root, blogRoot);
        events.push("unload");
        return new Promise((resolve) => {
          finishExit = resolve;
        });
      },
    },
    LatticaLandingNavigate() {
      events.push("activate");
    },
    location: {
      assign() {},
      href: "https://lattica.finance/blog/",
      origin: "https://lattica.finance",
      pathname: "/blog/",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "landing-page",
      metadata: { title: "Lattica" },
      root: landingRoot,
    }),
  });

  const navigation = router.navigate("https://lattica.finance/");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ["unload"]);
  finishExit();
  await navigation;
  assert.deepEqual(events, ["unload", "insert", "activate"]);
});

test("unloads the active landing view before caching it for a blog route", async () => {
  const api = await loadRouterApi();
  const events = [];
  const landingRoot = createRoot("whitepapers");
  const blogRoot = createRoot("blog");
  landingRoot.dataset.pageKind = "landing";
  blogRoot.dataset.pageKind = "blog";
  landingRoot.replaceWith = () => events.push("insert");
  let finishExit;
  const document = {
    body: { className: "landing-page modal-view" },
    querySelector(selector) {
      if (selector === "[data-page-content]") return landingRoot;
      if (selector.startsWith("script[src=")) return {};
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    history: { pushState() {} },
    LatticaBlogAnimations: {
      init() {
        events.push("activate");
      },
      prepare() {
        events.push("prepare");
      },
    },
    LatticaLandingExit(root) {
      assert.equal(root, landingRoot);
      events.push("unload");
      return new Promise((resolve) => {
        finishExit = resolve;
      });
    },
    location: {
      assign() {},
      href: "https://lattica.finance/whitepapers",
      origin: "https://lattica.finance",
      pathname: "/whitepapers",
    },
    scrollTo() {},
  };
  const router = api.createRouter({
    document,
    window,
    loadPage: async () => ({
      bodyClass: "blog-page",
      metadata: { title: "Blog — Lattica" },
      root: blogRoot,
    }),
  });

  const navigation = router.navigate("https://lattica.finance/blog/");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ["unload"]);
  finishExit();
  await navigation;
  assert.deepEqual(events, ["unload", "prepare", "insert", "activate"]);
});
