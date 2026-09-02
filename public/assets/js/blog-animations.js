(() => {
  const activeExits = new WeakMap();
  const animationRuns = new WeakMap();
  const initializedNavigationPages = new WeakSet();
  const originalTitles = new WeakMap();
  const pendingReloads = new WeakSet();
  const preparedPages = new WeakMap();

  function contentFor(page) {
    const queryRoot = page?.querySelectorAll ? page : document;
    const titleElements = [...queryRoot.querySelectorAll("[data-blog-scramble]")];
    const eyebrowElements = [
      ...queryRoot.querySelectorAll(".blog-eyebrow[data-blog-scramble]"),
    ];
    const revealElements = [
      ...queryRoot.querySelectorAll(
        ".article-list, .blog-back, .article-body",
      ),
    ];
    const titleEntries = titleElements.map((element) => {
      if (!originalTitles.has(element)) {
        originalTitles.set(element, element.textContent.trim());
      }

      return { element, text: originalTitles.get(element) };
    });

    return { eyebrowElements, revealElements, titleEntries };
  }

  function prepare(page = document.querySelector('[data-page-kind="blog"]')) {
    if (!page) return null;

    const content = contentFor(page);

    for (const { element, text } of content.titleEntries) {
      element.setAttribute("aria-label", text);
      element.textContent = text.replace(/[^\s]/g, "\u00A0");
    }

    for (const element of content.revealElements) {
      element.style.opacity = "0";
      element.style.transform = "translateY(6px)";
    }
    for (const element of content.eyebrowElements) element.style.opacity = "0";

    preparedPages.set(page, content);
    return content;
  }

  async function runExit(page) {
    if (!window.LatticaTextAnimations || !window.anime) return;

    const { eyebrowElements, revealElements, titleEntries } = contentFor(page);

    try {
      for (const { element } of titleEntries) {
        window.LatticaTextAnimations.cancelTextAnimation?.(element);
      }
      window.anime.remove?.(revealElements);
      if (revealElements.length) {
        await new Promise((resolve) => {
          window.anime({
            targets: revealElements,
            opacity: [1, 0],
            translateY: [0, -6],
            duration: 350,
            delay: window.anime.stagger(45, { direction: "reverse" }),
            easing: "easeOutCubic",
            complete: resolve,
          });
        });
      }

      await Promise.all(
        titleEntries.map(({ element, text }) =>
          window.LatticaTextAnimations.scrambleText(
            element,
            text,
            eyebrowElements.includes(element) ? 300 : 350,
            "out",
          ),
        ),
      );
      if (typeof window.setTimeout === "function") {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
    } catch (_) {}
  }

  function exit(page = document.querySelector('[data-page-kind="blog"]')) {
    if (!page) return Promise.resolve();

    const activeExit = activeExits.get(page);
    if (activeExit) return activeExit;

    animationRuns.set(page, {});
    const exitPromise = runExit(page).finally(() => {
      if (activeExits.get(page) === exitPromise) activeExits.delete(page);
    });
    activeExits.set(page, exitPromise);
    return exitPromise;
  }

  function init(page = document.querySelector('[data-page-kind="blog"]')) {
    if (!page) return;

    const activeExit = activeExits.get(page);
    if (activeExit) {
      if (!pendingReloads.has(page)) {
        pendingReloads.add(page);
        activeExit.finally(() => {
          pendingReloads.delete(page);
          init(page);
        });
      }
      return;
    }

    const animationRun = {};
    animationRuns.set(page, animationRun);

    const nav = document.querySelector(".site-nav");

    if (nav && !initializedNavigationPages.has(page)) {
      initializedNavigationPages.add(page);
      const updateNavScrolled = () => {
        if (!page.isConnected) return;
        nav.classList.toggle("scrolled", window.scrollY > 24);
      };

      window.addEventListener("scroll", updateNavScrolled, { passive: true });
      updateNavScrolled();

      const menuButton = document.getElementById("nav-menu-btn");
      const mobileMenu = document.getElementById("mobile-menu");

      if (menuButton && mobileMenu) {
        const setMenuOpen = (open) => {
          mobileMenu.classList.toggle("open", open);
          mobileMenu.setAttribute("aria-hidden", String(!open));
          menuButton.classList.toggle("is-open", open);
          menuButton.setAttribute("aria-expanded", String(open));
          menuButton.setAttribute(
            "aria-label",
            open ? "Close menu" : "Open menu",
          );
        };
        const isMenuOpen = () => mobileMenu.classList.contains("open");

        menuButton.addEventListener("click", (event) => {
          if (!page.isConnected) return;
          event.stopPropagation();
          setMenuOpen(!isMenuOpen());
        });
        document
          .querySelectorAll(".mobile-menu-item, .mobile-menu-x")
          .forEach((link) => {
            link.addEventListener("click", () => {
              if (page.isConnected) setMenuOpen(false);
            });
          });
        mobileMenu.addEventListener("click", (event) => {
          if (!page.isConnected) return;
          if (event.target === mobileMenu) setMenuOpen(false);
        });
        document.addEventListener("keydown", (event) => {
          if (!page.isConnected) return;
          if (event.key === "Escape" && isMenuOpen()) setMenuOpen(false);
        });
        window
          .matchMedia("(min-width: 769px)")
          .addEventListener("change", (event) => {
            if (!page.isConnected) return;
            if (event.matches && isMenuOpen()) setMenuOpen(false);
          });
      }
    }

    const { eyebrowElements, revealElements, titleEntries } =
      preparedPages.get(page) || prepare(page);
    preparedPages.delete(page);

    function revealImmediately() {
      for (const { element, text } of titleEntries) element.textContent = text;
      for (const element of revealElements) {
        element.style.opacity = "1";
        element.style.transform = "translateY(0)";
      }
      for (const element of eyebrowElements) element.style.opacity = "1";
    }

    if (!window.LatticaTextAnimations || !window.anime) {
      revealImmediately();
      return;
    }

    if (eyebrowElements.length) {
      window.anime({
        targets: eyebrowElements,
        opacity: [0, 1],
        duration: 350,
        easing: "easeOutCubic",
      });
    }

    Promise.all(
      titleEntries.map(({ element, text }) =>
        window.LatticaTextAnimations.scrambleText(
          element,
          text,
          eyebrowElements.includes(element) ? 450 : 550,
          "in",
        ),
      ),
    )
      .then(() => {
        if (animationRuns.get(page) !== animationRun) return;
        window.anime({
          targets: revealElements,
          opacity: [0, 1],
          translateY: [6, 0],
          duration: 450,
          delay: window.anime.stagger(60),
          easing: "easeOutCubic",
        });
      })
      .catch(() => {
        if (animationRuns.get(page) === animationRun) revealImmediately();
      });
  }

  window.LatticaBlogAnimations = { exit, init, prepare };

  const initialPage = document.querySelector('[data-page-kind="blog"]');
  const persistentNavigation = document.querySelector(".site-nav");
  const shouldDelayInitialReveal =
    initialPage &&
    persistentNavigation?.dataset?.persistentReady !== "true" &&
    typeof window.setTimeout === "function";

  if (shouldDelayInitialReveal) {
    prepare(initialPage);
    window.setTimeout(() => {
      if (initialPage.isConnected) init(initialPage);
    }, 500);
  } else {
    init(initialPage);
  }
})();
