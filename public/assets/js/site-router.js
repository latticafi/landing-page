(() => {
  const LANDING_PATHS = new Set(["/", "/whitepapers", "/waitlist", "/careers"]);
  const META_FIELDS = [
    ["description", 'meta[name="description"]', "content"],
    ["canonical", 'link[rel="canonical"]', "href"],
    ["ogType", 'meta[property="og:type"]', "content"],
    ["ogTitle", 'meta[property="og:title"]', "content"],
    ["ogDescription", 'meta[property="og:description"]', "content"],
    ["ogUrl", 'meta[property="og:url"]', "content"],
    ["twitterTitle", 'meta[name="twitter:title"]', "content"],
    ["twitterDescription", 'meta[name="twitter:description"]', "content"],
  ];

  function normalizedPath(pathname) {
    if (pathname.length > 1 && pathname.endsWith("/")) {
      return pathname.slice(0, -1);
    }
    return pathname;
  }

  function isLandingPath(pathname) {
    return LANDING_PATHS.has(normalizedPath(pathname));
  }

  function routeKey(url) {
    return `${normalizedPath(url.pathname)}${url.search}`;
  }

  function rootKey(url) {
    return isLandingPath(url.pathname) ? "landing" : routeKey(url);
  }

  function readMetadata(documentRef) {
    const metadata = { title: documentRef.title || "" };

    for (const [key, selector, attribute] of META_FIELDS) {
      const element = documentRef.querySelector(selector);
      metadata[key] = element?.getAttribute?.(attribute) || "";
    }

    return metadata;
  }

  function applyMetadata(documentRef, metadata) {
    if (!metadata) return;
    if (metadata.title) documentRef.title = metadata.title;

    for (const [key, selector, attribute] of META_FIELDS) {
      if (!metadata[key]) continue;
      documentRef.querySelector(selector)?.setAttribute(attribute, metadata[key]);
    }
  }

  function pageKind(root) {
    return root?.dataset?.pageKind || root?.getAttribute?.("data-page-kind") || "";
  }

  function createRouter(options) {
    const documentRef = options.document;
    const windowRef = options.window;
    const loadPage =
      options.loadPage ||
      (async (url) => {
        const response = await windowRef.fetch(url, {
          headers: { Accept: "text/html" },
        });

        if (!response.ok) throw new Error(`Navigation failed with ${response.status}`);

        const html = await response.text();
        const parsed = new windowRef.DOMParser().parseFromString(html, "text/html");
        const root = parsed.querySelector("[data-page-content]");

        if (!root) throw new Error("Navigation response is missing page content");

        return {
          bodyClass: parsed.body.className,
          metadata: readMetadata(parsed),
          root,
        };
      });
    let currentRoot = documentRef.querySelector("[data-page-content]");
    let activeUrl = new URL(windowRef.location.href);
    let navigationSequence = 0;
    let started = false;
    const activeNavigations = new Set();
    const roots = new Map();
    const pages = new Map();

    if (currentRoot) {
      roots.set(rootKey(activeUrl), currentRoot);
      pages.set(routeKey(activeUrl), {
        bodyClass: documentRef.body.className,
        metadata: readMetadata(documentRef),
      });
    }

    function syncNavigation(pathname) {
      const links = documentRef.querySelectorAll?.(
        ".nav-text-btn[href], .mobile-menu-item[href]",
      );

      if (!links) return;

      for (const link of links) {
        const linkPath = normalizedPath(new URL(link.href, activeUrl.href).pathname);
        const active =
          linkPath === "/blog"
            ? normalizedPath(pathname).startsWith("/blog")
            : linkPath === normalizedPath(pathname);

        link.classList?.toggle("active", active);
        if (active) link.setAttribute?.("aria-current", "page");
        else link.removeAttribute?.("aria-current");
      }
    }

    async function ensureScript(src) {
      if (documentRef.querySelector(`script[src="${src}"]`)) return;

      await new Promise((resolve, reject) => {
        const script = documentRef.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Unable to load ${src}`));
        documentRef.body.append(script);
      });
    }

    async function preparePage(root) {
      if (pageKind(root) !== "blog") return;

      await ensureScript("/assets/js/blog-animations.js");
      windowRef.LatticaBlogAnimations?.prepare(root);
    }

    async function deactivatePage(root) {
      const kind = pageKind(root);

      if (kind === "landing") {
        await ensureScript("/assets/js/app.js");
        return windowRef.LatticaLandingExit?.(root);
      } else if (kind === "blog") {
        await ensureScript("/assets/js/blog-animations.js");
        return windowRef.LatticaBlogAnimations?.exit?.(root);
      }
    }

    async function activatePage(root, pathname, activationOptions = {}) {
      const kind = pageKind(root);

      if (kind === "landing") {
        await ensureScript("/assets/js/app.js");
        await windowRef.LatticaLandingNavigate?.(pathname, {
          push: false,
          replay: activationOptions.replay === true,
        });
      } else if (kind === "blog") {
        await ensureScript("/assets/js/blog-animations.js");
        windowRef.LatticaBlogAnimations?.init(root);
      }
    }

    async function navigate(rawUrl, navigationOptions = {}) {
      const url = new URL(rawUrl, activeUrl.href);
      const sequence = ++navigationSequence;
      const interruptedNavigation = activeNavigations.size > 0;
      activeNavigations.add(sequence);

      try {
        if (routeKey(url) === routeKey(activeUrl) && url.hash === activeUrl.hash) {
          const browserUrl = new URL(windowRef.location.href, activeUrl.href);
          const routeStateDiverged =
            routeKey(browserUrl) !== routeKey(activeUrl) ||
            browserUrl.hash !== activeUrl.hash;

          if (routeStateDiverged) {
            const page = pages.get(routeKey(url));
            if (page) {
              documentRef.body.className = page.bodyClass;
              applyMetadata(documentRef, page.metadata);
            }
            if (navigationOptions.history !== "none") {
              windowRef.history.pushState(
                { path: url.pathname },
                "",
                `${url.pathname}${url.search}${url.hash}`,
              );
            }
            activeUrl = url;
          }

          syncNavigation(url.pathname);
          if (
            currentRoot &&
            (interruptedNavigation ||
              routeStateDiverged ||
              navigationOptions.forceActivation === true)
          ) {
            await activatePage(currentRoot, url.pathname);
          }
          if (!url.hash) windowRef.scrollTo(0, 0);
          return true;
        }

        let page = pages.get(routeKey(url));
        let nextRoot = roots.get(rootKey(url));

        if (!page || !nextRoot) {
          const loaded = await loadPage(url.href);
          if (sequence !== navigationSequence) return false;

          page = {
            bodyClass: loaded.bodyClass,
            metadata: loaded.metadata,
          };
          pages.set(routeKey(url), page);

          if (!nextRoot) {
            nextRoot = loaded.root;
            roots.set(rootKey(url), nextRoot);
          }
        }

        if (!currentRoot || !nextRoot) {
          throw new Error("Navigation requires current and destination content");
        }

        const currentPage = pages.get(routeKey(activeUrl));
        if (currentPage) currentPage.bodyClass = documentRef.body.className;

        const rootChanged = currentRoot !== nextRoot;

        if (rootChanged) {
          const deactivated = await deactivatePage(currentRoot);
          if (sequence !== navigationSequence || deactivated === false) return false;
          await preparePage(nextRoot);
          if (sequence !== navigationSequence) return false;
          currentRoot.replaceWith(nextRoot);
        }
        currentRoot = nextRoot;
        activeUrl = url;
        documentRef.body.className = page.bodyClass;
        applyMetadata(documentRef, page.metadata);

        if (navigationOptions.history !== "none") {
          windowRef.history.pushState(
            { path: url.pathname },
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
        }

        syncNavigation(url.pathname);
        windowRef.scrollTo(0, 0);
        await activatePage(currentRoot, url.pathname, { replay: rootChanged });
        return true;
      } catch (_) {
        if (sequence === navigationSequence) windowRef.location.assign(url.href);
        return false;
      } finally {
        activeNavigations.delete(sequence);
      }
    }

    async function handleClick(event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const link = event.target?.closest?.("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const url = new URL(link.href, activeUrl.href);
      if (url.origin !== windowRef.location.origin) return;
      if (
        url.pathname === activeUrl.pathname &&
        url.search === activeUrl.search &&
        url.hash
      ) {
        return;
      }

      event.preventDefault();
      await navigate(url.href);
    }

    function closeMobileMenu() {
      const mobileMenu = documentRef.getElementById?.("mobile-menu");
      const menuButton = documentRef.getElementById?.("nav-menu-btn");

      mobileMenu?.classList?.remove("open");
      mobileMenu?.setAttribute?.("aria-hidden", "true");
      menuButton?.classList?.remove("is-open");
      menuButton?.setAttribute?.("aria-expanded", "false");
      menuButton?.setAttribute?.("aria-label", "Open menu");
    }

    async function handlePersistentNavigationClick(event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const link = event.target?.closest?.("a[href]");
      if (!link?.closest?.(".site-nav, .mobile-menu")) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;

      const url = new URL(link.href, activeUrl.href);
      if (url.origin !== windowRef.location.origin) return;

      event.preventDefault();
      event.stopPropagation();
      closeMobileMenu();
      await navigate(url.href);
    }

    async function handlePopState() {
      const url = new URL(windowRef.location.href);
      await navigate(url.href, { forceActivation: true, history: "none" });
    }

    function start() {
      if (started) return;
      started = true;
      documentRef.addEventListener("click", handlePersistentNavigationClick, true);
      documentRef.addEventListener("click", handleClick);
      windowRef.addEventListener("popstate", handlePopState);
      if (pageKind(currentRoot) === "blog") {
        const navigation = documentRef.querySelector("nav");
        if (navigation) navigation.dataset.persistentReady = "true";
      }
      syncNavigation(activeUrl.pathname);
    }

    return { navigate, start };
  }

  window.LatticaSiteRouter = { createRouter };

  if (typeof document !== "undefined") {
    const router = createRouter({ document, window });
    window.LatticaSiteRouter.router = router;
    router.start();
  }
})();
