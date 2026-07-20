(() => {
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
  window.scrollTo(0, 0);
  let scrollUnlocked = false;
  function unlockScroll() {
    if (scrollUnlocked) return;
    scrollUnlocked = true;
    document.body.classList.remove("intro-locked");
  }
  setTimeout(unlockScroll, 4000);
  const WAITLIST_ENDPOINT = "/api/waitlist";
  const TURNSTILE_SITE_KEY =
    document.querySelector('meta[name="turnstile-site-key"]')?.content ||
    "1x00000000000000000000AA";
  // Canvas lattice background rendering lives in lattice-bg.js (shared
  // across pages). We reuse its `intro` state object to drive this page's
  // fade-in sequence, and its rebuild() on resize.
  const intro = window.LatticeBG.intro;
  intro.phase = "waiting";
  intro.ambientOpacity = 0;
  const CHARS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&";
  function scrambleText(el, targetText, duration, direction) {
    return new Promise((resolve) => {
      const len = targetText.length;
      let startTime = null;
      function tick(ts) {
        if (!startTime) startTime = ts;
        const progress = Math.min(1, (ts - startTime) / duration);
        let result = "";
        for (let i = 0; i < len; i++) {
          if (targetText[i] === " " || targetText[i] === "\n") {
            result += targetText[i];
            continue;
          }
          const ct = i / len;
          if (direction === "in") {
            const cp = (progress - ct * 0.5) / 0.5;
            if (cp >= 1) result += targetText[i];
            else if (cp > 0)
              result += CHARS[Math.floor(Math.random() * CHARS.length)];
            else result += "\u00A0";
          } else {
            const cp = (progress - ct * 0.4) / 0.6;
            if (cp >= 1) result += "\u00A0";
            else if (cp > 0)
              result += CHARS[Math.floor(Math.random() * CHARS.length)];
            else result += targetText[i];
          }
        }
        el.textContent = result;
        if (progress < 1) requestAnimationFrame(tick);
        else {
          el.textContent = direction === "in" ? targetText : "";
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }
  function scrambleHeroTwoTone(el, line1, line2, duration, direction) {
    return new Promise((resolve) => {
      const full = line1 + "\n" + line2;
      const len = full.length;
      const splitAt = line1.length;
      let startTime = null;
      function tick(ts) {
        if (!startTime) startTime = ts;
        const progress = Math.min(1, (ts - startTime) / duration);
        let part1 = "",
          part2 = "";
        for (let i = 0; i < len; i++) {
          const ch = full[i];
          if (ch === " " || ch === "\n") {
            if (i <= splitAt) part1 += ch === "\n" ? "" : ch;
            else part2 += ch;
            continue;
          }
          const ct = i / len;
          let outCh;
          if (direction === "in") {
            const cp = (progress - ct * 0.5) / 0.5;
            if (cp >= 1) outCh = ch;
            else if (cp > 0)
              outCh = CHARS[Math.floor(Math.random() * CHARS.length)];
            else outCh = "\u00A0";
          } else {
            const cp = (progress - ct * 0.4) / 0.6;
            if (cp >= 1) outCh = "\u00A0";
            else if (cp > 0)
              outCh = CHARS[Math.floor(Math.random() * CHARS.length)];
            else outCh = ch;
          }
          if (i < splitAt) part1 += outCh;
          else if (i > splitAt) part2 += outCh;
        }
        el.innerHTML = '<span class="dim">' + part1 + "</span>\n" + part2;
        if (progress < 1) requestAnimationFrame(tick);
        else {
          if (direction === "in")
            el.innerHTML =
              '<span class="dim">' +
              line1 +
              "</span>\n" +
              line2.replace("10X", '<span class="bold">10X</span>');
          else el.innerHTML = "";
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }
  const heroH1 = document.getElementById("hero-h1");
  const heroSub = document.getElementById("hero-sub");
  const heroCta = document.getElementById("hero-cta");
  const HERO_LINE1 = heroH1.dataset.line1 || "Prediction Markets";
  const HERO_LINE2 = heroH1.dataset.line2 || "at 10X";
  heroH1.textContent = "";
  let resizeReady = false;
  const navEl = document.querySelector("nav");
  const tl = anime.timeline({ easing: "easeOutCubic" });
  intro.phase = "ambient";
  tl.add({
    targets: intro,
    ambientOpacity: [0, 1],
    duration: 1200,
    delay: 150,
    easing: "easeOutCubic",
    complete: () => {
      intro.phase = "done";
    },
  });
  tl.add(
    {
      targets: navEl,
      borderBottomColor: ["rgba(255,255,255,0)", "rgba(255,255,255,0.09)"],
      duration: 700,
      easing: "linear",
    },
    "-=900",
  );
  tl.add(
    {
      targets: ".logo",
      opacity: [0, 1],
      translateY: [-6, 0],
      duration: 450,
    },
    "-=750",
  );
  tl.add(
    {
      targets: ".nav-links li",
      opacity: [0, 1],
      translateY: [-6, 0],
      duration: 350,
      delay: anime.stagger(30),
    },
    "-=550",
  );
  tl.add(
    {
      targets: [".nav-end", ".nav-menu-btn"],
      opacity: [0, 1],
      translateY: [-6, 0],
      duration: 350,
      complete: () => {
        setTimeout(() => {
          resizeReady = true;
        }, 2000);
        let resizeTimer;
        window.addEventListener("resize", () => {
          if (!resizeReady) return;
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            window.LatticeBG.rebuild();
          }, 150);
        });
      },
    },
    "-=350",
  );
  const papersView = document.getElementById("papers-view");
  const waitlistView = document.getElementById("waitlist-view");
  const wpBtn = document.getElementById("whitepapers-btn");
  const waitlistBtn = document.getElementById("waitlist-btn");
  const homeBtn = document.getElementById("home-btn");
  const logoBtn = document.getElementById("logo-btn");
  const paperTitle1 = document.getElementById("paper-title-1");
  const paperTitle2 = document.getElementById("paper-title-2");
  const paperNum1 = document.getElementById("paper-num-1");
  const paperNum2 = document.getElementById("paper-num-2");
  const paperDivider = document.getElementById("paper-divider");
  const papersBack = document.getElementById("papers-back");
  const PAPER_1_TEXT =
    paperTitle1.dataset.text || "Unlocking Liquidity on Prediction Markets";
  const PAPER_2_TEXT = paperTitle2.dataset.text || "Introducing Lattica";
  const waitlistEyebrow = document.getElementById("waitlist-eyebrow");
  const waitlistTitle = document.getElementById("waitlist-title");
  const waitlistForm = document.getElementById("waitlist-form");
  const waitlistInput = document.getElementById("waitlist-input");
  const waitlistSubmit = document.getElementById("waitlist-submit");
  const waitlistStatus = document.getElementById("waitlist-status");
  const waitlistBack = document.getElementById("waitlist-back");
  const WAITLIST_TITLE = "Join the waitlist";
  const WAITLIST_EYEBROW = "EARLY ACCESS";
  const careersView = document.getElementById("careers-view");
  const careersBtn = document.getElementById("careers-btn");
  const careersEyebrow = document.getElementById("careers-eyebrow");
  const careersTitle = document.getElementById("careers-title");
  const careersBack = document.getElementById("careers-back");
  const roleTitle1 = document.getElementById("role-title-1");
  const roleTitle2 = document.getElementById("role-title-2");
  const roleDivider = document.getElementById("role-divider");
  const CAREERS_TITLE = "Careers";
  const CAREERS_EYEBROW = "JOIN THE TEAM";
  const ROLE_1_TEXT = roleTitle1.dataset.text || "Head of Growth";
  const ROLE_2_TEXT = roleTitle2.dataset.text || "Founding Engineer";
  let currentView = "home";
  let animating = false;
  let waitlistSubmitted = false;
  const PATH_FOR_VIEW = {
    home: "/",
    whitepapers: "/whitepapers",
    waitlist: "/waitlist",
    careers: "/careers",
  };
  const VIEW_FOR_PATH = {
    "/": "home",
    "/whitepapers": "whitepapers",
    "/waitlist": "waitlist",
    "/careers": "careers",
  };
  function viewForPath(pathname) {
    let p = pathname;
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return VIEW_FOR_PATH[p] || "home";
  }
  function updatePath(view, push) {
    const newPath = PATH_FOR_VIEW[view] || "/";
    if (window.location.pathname !== newPath) {
      if (push) history.pushState({ view }, "", newPath);
      else history.replaceState({ view }, "", newPath);
    }
  }
  function updateActiveBtn(view) {
    wpBtn.classList.toggle("active", view === "whitepapers");
    waitlistBtn.classList.toggle("active", view === "waitlist");
    careersBtn.classList.toggle("active", view === "careers");
    homeBtn.classList.toggle("active", view === "home");
    document.querySelectorAll(".mobile-menu-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
  }
  async function exitView(view) {
    if (view === "home") {
      anime({
        targets: [heroSub, heroCta],
        opacity: [1, 0],
        translateY: [0, -4],
        duration: 250,
        easing: "easeOutCubic",
      });
      await scrambleHeroTwoTone(heroH1, HERO_LINE1, HERO_LINE2, 450, "out");
      heroH1.style.display = "none";
      heroSub.style.display = "none";
      heroCta.style.display = "none";
    } else if (view === "whitepapers") {
      anime({
        targets: [paperNum1, paperNum2, paperDivider, papersBack],
        opacity: 0,
        duration: 200,
        easing: "easeOutCubic",
      });
      await Promise.all([
        scrambleText(paperTitle1, PAPER_1_TEXT, 400, "out"),
        scrambleText(paperTitle2, PAPER_2_TEXT, 400, "out"),
      ]);
      papersView.classList.remove("visible");
    } else if (view === "waitlist") {
      anime({
        targets: [waitlistForm, waitlistStatus, waitlistBack],
        opacity: 0,
        duration: 200,
        easing: "easeOutCubic",
      });
      await Promise.all([
        scrambleText(waitlistEyebrow, WAITLIST_EYEBROW, 300, "out"),
        scrambleText(waitlistTitle, WAITLIST_TITLE, 350, "out"),
      ]);
      waitlistView.classList.remove("visible");
    } else if (view === "careers") {
      anime({
        targets: [roleDivider, careersBack],
        opacity: 0,
        duration: 200,
        easing: "easeOutCubic",
      });
      await Promise.all([
        scrambleText(careersEyebrow, CAREERS_EYEBROW, 300, "out"),
        scrambleText(careersTitle, CAREERS_TITLE, 350, "out"),
        scrambleText(roleTitle1, ROLE_1_TEXT, 400, "out"),
        scrambleText(roleTitle2, ROLE_2_TEXT, 400, "out"),
      ]);
      careersView.classList.remove("visible");
    }
  }
  async function enterView(view) {
    if (view === "home") {
      heroH1.style.display = "";
      heroCta.style.display = "";
      heroSub.style.display = "";
      await scrambleHeroTwoTone(heroH1, HERO_LINE1, HERO_LINE2, 550, "in");
      anime({
        targets: [heroSub, heroCta],
        opacity: [0, 1],
        translateY: [6, 0],
        duration: 500,
        delay: anime.stagger(80),
        easing: "easeOutCubic",
      });
    } else if (view === "whitepapers") {
      paperTitle1.textContent = "";
      paperTitle2.textContent = "";
      papersView.classList.add("visible");
      anime({
        targets: paperNum1,
        opacity: [0, 1],
        duration: 300,
        easing: "easeOutCubic",
      });
      anime({
        targets: paperNum2,
        opacity: [0, 1],
        duration: 300,
        delay: 50,
        easing: "easeOutCubic",
      });
      anime({
        targets: paperDivider,
        opacity: [0, 1],
        duration: 400,
        delay: 200,
        easing: "easeOutCubic",
      });
      await Promise.all([
        scrambleText(paperTitle1, PAPER_1_TEXT, 600, "in"),
        scrambleText(paperTitle2, PAPER_2_TEXT, 600, "in"),
      ]);
      anime({
        targets: papersBack,
        opacity: [0, 1],
        duration: 400,
        easing: "easeOutCubic",
      });
    } else if (view === "waitlist") {
      waitlistTitle.textContent = "";
      waitlistStatus.textContent = "";
      waitlistStatus.classList.remove("visible", "error", "success");
      waitlistView.classList.add("visible");
      if (!waitlistSubmitted) {
        waitlistInput.disabled = false;
        waitlistSubmit.disabled = false;
        waitlistSubmit.textContent = "Join now";
      } else {
        waitlistInput.disabled = true;
        waitlistSubmit.disabled = true;
        waitlistSubmit.textContent = "Submitted";
        waitlistStatus.textContent = "You're on the list. We'll be in touch.";
        waitlistStatus.classList.add("visible", "success");
      }
      waitlistEyebrow.textContent = "";
      anime({
        targets: waitlistEyebrow,
        opacity: [0, 1],
        duration: 350,
        easing: "easeOutCubic",
      });
      scrambleText(waitlistEyebrow, WAITLIST_EYEBROW, 450, "in");
      await scrambleText(waitlistTitle, WAITLIST_TITLE, 550, "in");
      anime({
        targets: waitlistForm,
        opacity: [0, 1],
        translateY: [6, 0],
        duration: 500,
        delay: 120,
        easing: "easeOutCubic",
      });
      anime({
        targets: waitlistBack,
        opacity: [0, 1],
        duration: 400,
        delay: 250,
        easing: "easeOutCubic",
      });
    } else if (view === "careers") {
      careersTitle.textContent = "";
      careersEyebrow.textContent = "";
      roleTitle1.textContent = "";
      roleTitle2.textContent = "";
      careersView.classList.add("visible");
      anime({
        targets: careersEyebrow,
        opacity: [0, 1],
        duration: 350,
        easing: "easeOutCubic",
      });
      anime({
        targets: roleDivider,
        opacity: [0, 1],
        duration: 400,
        delay: 400,
        easing: "easeOutCubic",
      });
      scrambleText(careersEyebrow, CAREERS_EYEBROW, 450, "in");
      await Promise.all([
        scrambleText(careersTitle, CAREERS_TITLE, 550, "in"),
        scrambleText(roleTitle1, ROLE_1_TEXT, 900, "in"),
        scrambleText(roleTitle2, ROLE_2_TEXT, 900, "in"),
      ]);
      anime({
        targets: careersBack,
        opacity: [0, 1],
        duration: 400,
        easing: "easeOutCubic",
      });
    }
  }
  async function setView(newView, opts) {
    opts = opts || {};
    if (animating) return;
    if (newView === currentView) return;
    if (newView !== "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.body.classList.add("modal-view");
    } else {
      document.body.classList.remove("modal-view");
    }
    animating = true;
    updateActiveBtn(newView);
    updatePath(newView, opts.push !== false);
    if (!opts.skipExit) {
      await exitView(currentView);
    }
    currentView = newView;
    await enterView(newView);
    animating = false;
  }
  wpBtn.addEventListener("click", (e) => {
    e.preventDefault();
    setView(currentView === "whitepapers" ? "home" : "whitepapers");
  });
  waitlistBtn.addEventListener("click", (e) => {
    e.preventDefault();
    setView(currentView === "waitlist" ? "home" : "waitlist");
  });
  careersBtn.addEventListener("click", (e) => {
    e.preventDefault();
    setView(currentView === "careers" ? "home" : "careers");
  });
  homeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentView !== "home") {
      setView("home");
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  logoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentView !== "home") {
      setView("home");
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  heroCta.addEventListener("click", (e) => {
    e.preventDefault();
    setView("waitlist");
  });
  const hiwCta = document.getElementById("hiw-cta");
  if (hiwCta) {
    hiwCta.addEventListener("click", (e) => {
      e.preventDefault();
      setView("waitlist");
    });
  }
  papersBack.addEventListener("click", () => {
    if (currentView === "whitepapers") setView("home");
  });
  waitlistBack.addEventListener("click", () => {
    if (currentView === "waitlist") setView("home");
  });
  careersBack.addEventListener("click", () => {
    if (currentView === "careers") setView("home");
  });
  function updateNavScrolled() {
    if (window.scrollY > 24) navEl.classList.add("scrolled");
    else navEl.classList.remove("scrolled");
  }
  window.addEventListener("scroll", updateNavScrolled, { passive: true });
  updateNavScrolled();
  const hiwSection = document.getElementById("how-it-works");
  if (hiwSection) {
    const hiwTitleEl = hiwSection.querySelector(".hiw-title");
    const hiwCardEls = Array.from(hiwSection.querySelectorAll(".hiw-card"));
    const hiwCardTitleEls = Array.from(
      hiwSection.querySelectorAll(".hiw-card-title"),
    );
    const HIW_TITLE_TEXT = hiwTitleEl.textContent;
    const HIW_CARD_TITLES = hiwCardTitleEls.map((el) => el.textContent);
    hiwTitleEl.textContent = "";
    hiwCardEls.forEach((el) => (el.style.opacity = "0"));
    hiwCardTitleEls.forEach((el) => (el.textContent = ""));
    let hiwRevealed = false;
    async function revealHowItWorks() {
      if (hiwRevealed) return;
      hiwRevealed = true;
      scrambleText(hiwTitleEl, HIW_TITLE_TEXT, 550, "in");
      await new Promise((r) => setTimeout(r, 280));
      anime({
        targets: hiwCardEls,
        opacity: [0, 1],
        translateY: [14, 0],
        duration: 600,
        delay: anime.stagger(120),
        easing: "easeOutCubic",
      });
      hiwCardTitleEls.forEach((el, i) => {
        setTimeout(
          () => scrambleText(el, HIW_CARD_TITLES[i], 500, "in"),
          i * 120 + 140,
        );
      });
    }
    const hiwOnScroll = () => {
      if (window.scrollY > 0) {
        revealHowItWorks();
        window.removeEventListener("scroll", hiwOnScroll);
      }
    };
    window.addEventListener("scroll", hiwOnScroll, { passive: true });
  }
  const menuBtn = document.getElementById("nav-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");
  function openMenu() {
    mobileMenu.classList.add("open");
    mobileMenu.setAttribute("aria-hidden", "false");
    menuBtn.setAttribute("aria-expanded", "true");
    menuBtn.setAttribute("aria-label", "Close menu");
    menuBtn.classList.add("is-open");
  }
  function closeMenu() {
    mobileMenu.classList.remove("open");
    mobileMenu.setAttribute("aria-hidden", "true");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-label", "Open menu");
    menuBtn.classList.remove("is-open");
  }
  function isMenuOpen() {
    return mobileMenu.classList.contains("open");
  }
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isMenuOpen() ? closeMenu() : openMenu();
  });
  document.querySelectorAll(".mobile-menu-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const view = btn.dataset.view;
      closeMenu();
      setTimeout(() => {
        setView(currentView === view ? "home" : view);
      }, 250);
    });
  });
  mobileMenu.addEventListener("click", (e) => {
    if (e.target === mobileMenu) closeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isMenuOpen()) closeMenu();
  });
  const mq = window.matchMedia("(min-width: 769px)");
  mq.addEventListener("change", (e) => {
    if (e.matches && isMenuOpen()) closeMenu();
  });
  window.addEventListener("popstate", () => {
    const wantView = viewForPath(window.location.pathname);
    if (wantView !== currentView) setView(wantView, { push: false });
  });
  let turnstileWidgetId = null;
  let turnstilePending = null;
  let turnstileReadyResolve = null;
  const turnstileReady = new Promise((res) => {
    turnstileReadyResolve = res;
  });
  function renderTurnstile() {
    if (turnstileWidgetId !== null) return true;
    if (!window.turnstile) return false;
    try {
      turnstileWidgetId = window.turnstile.render("#turnstile-container", {
        sitekey: TURNSTILE_SITE_KEY,
        execution: "execute",
        appearance: "interaction-only",
        callback: (token) => {
          turnstilePending?.resolve(token);
          turnstilePending = null;
        },
        "error-callback": () => {
          turnstilePending?.reject(new Error("turnstile_error"));
          turnstilePending = null;
        },
        "timeout-callback": () => {
          turnstilePending?.reject(new Error("turnstile_timeout"));
          turnstilePending = null;
        },
      });
    } catch (err) {
      console.error("turnstile render failed:", err);
      return false;
    }
    if (turnstileWidgetId !== null) turnstileReadyResolve(true);
    return turnstileWidgetId !== null;
  }
  if (window.turnstile) {
    renderTurnstile();
  } else {
    let tries = 0;
    const iv = setInterval(() => {
      if (window.turnstile) {
        clearInterval(iv);
        renderTurnstile();
      } else if (++tries > 80) {
        clearInterval(iv);
      }
    }, 100);
  }
  function getTurnstileToken() {
    return new Promise(async (resolve, reject) => {
      const ready = await Promise.race([
        turnstileReady,
        new Promise((r) => setTimeout(() => r(false), 4000)),
      ]);
      if (!ready || turnstileWidgetId === null) {
        reject(new Error("turnstile_not_loaded"));
        return;
      }
      try {
        window.turnstile.reset(turnstileWidgetId);
      } catch (_) {}
      turnstilePending = { resolve, reject };
      try {
        window.turnstile.execute(turnstileWidgetId);
      } catch (err) {
        turnstilePending = null;
        reject(err);
      }
    });
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function setWaitlistStatus(msg, kind) {
    waitlistStatus.textContent = msg;
    waitlistStatus.classList.remove("error", "success");
    if (kind) waitlistStatus.classList.add(kind);
    waitlistStatus.classList.add("visible");
  }
  async function submitWaitlist(email, turnstileToken) {
    if (!WAITLIST_ENDPOINT) {
      await new Promise((r) => setTimeout(r, 700));
      return { ok: true };
    }
    try {
      const res = await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, turnstileToken }),
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch (_) {}
      return { ok: res.ok, payload };
    } catch (err) {
      return { ok: false };
    }
  }
  waitlistForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (waitlistSubmitted) return;
    const email = waitlistInput.value.trim();
    if (!EMAIL_RE.test(email)) {
      setWaitlistStatus("Please enter a valid email.", "error");
      waitlistInput.focus();
      return;
    }
    waitlistInput.disabled = true;
    waitlistSubmit.disabled = true;
    waitlistSubmit.textContent = "Submitting";
    setWaitlistStatus("", null);
    waitlistStatus.classList.remove("visible");
    let turnstileToken = "";
    if (WAITLIST_ENDPOINT) {
      try {
        turnstileToken = await getTurnstileToken();
      } catch (err) {
        waitlistInput.disabled = false;
        waitlistSubmit.disabled = false;
        waitlistSubmit.textContent = "Join now";
        setWaitlistStatus("Verification failed. Please try again.", "error");
        return;
      }
    }
    waitlistSubmit.textContent = "Submitting";
    const result = await submitWaitlist(email, turnstileToken);
    if (result.ok) {
      waitlistSubmitted = true;
      waitlistSubmit.textContent = "Submitted";
      setWaitlistStatus("You're on the list. We'll be in touch.", "success");
    } else {
      waitlistInput.disabled = false;
      waitlistSubmit.disabled = false;
      waitlistSubmit.textContent = "Join now";
      const errCode = result.payload?.error;
      const msg =
        errCode === "rate_limited"
          ? "Too many requests. Please slow down."
          : errCode === "turnstile_failed"
            ? "Verification failed. Please try again."
            : errCode === "invalid_email"
              ? "Please enter a valid email."
              : "Something went wrong. Please try again.";
      setWaitlistStatus(msg, "error");
    }
  });
  const startView = viewForPath(window.location.pathname);
  setTimeout(() => {
    if (startView === "home") {
      updateActiveBtn("home");
      scrambleHeroTwoTone(heroH1, HERO_LINE1, HERO_LINE2, 650, "in").then(
        () => {
          anime({
            targets: [heroSub, heroCta],
            opacity: [0, 1],
            translateY: [6, 0],
            duration: 450,
            delay: anime.stagger(80),
            easing: "easeOutCubic",
            complete: unlockScroll,
          });
        },
      );
    } else {
      currentView = "home";
      document.body.classList.add("modal-view");
      updateActiveBtn(startView);
      updatePath(startView, false);
      heroH1.style.display = "none";
      heroCta.style.display = "none";
      heroSub.style.display = "none";
      (async () => {
        animating = true;
        await enterView(startView);
        currentView = startView;
        animating = false;
        unlockScroll();
      })();
    }
  }, 500);
  function makeSlider(wrap, { min, max, value, step, onChange }) {
    const track = wrap.querySelector('[data-role="slider-track"]');
    const fill = track.querySelector(".hiw-mock-slider-fill");
    const thumb = track.querySelector(".hiw-mock-slider-thumb");
    const markers = track.querySelectorAll(".hiw-mock-slider-marker");
    let v = value;
    function render() {
      const pct = ((v - min) / (max - min)) * 100;
      fill.style.width = `${pct}%`;
      thumb.style.left = `${pct}%`;
      if (markers.length) {
        markers.forEach((m) => {
          const mp = parseFloat(m.style.left);
          m.classList.toggle("hiw-mock-slider-marker-lit", mp <= pct + 0.1);
        });
      }
    }
    function setValue(nv, fire = true) {
      nv = Math.max(min, Math.min(max, nv));
      if (step) nv = Math.round(nv / step) * step;
      if (nv === v) return;
      v = nv;
      render();
      if (fire) onChange(v);
    }
    function clientToValue(clientX) {
      const rect = track.getBoundingClientRect();
      const pct = Math.max(
        0,
        Math.min(100, ((clientX - rect.left) / rect.width) * 100),
      );
      return min + (pct / 100) * (max - min);
    }
    function onMove(e) {
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setValue(clientToValue(x));
      if (e.cancelable) e.preventDefault();
    }
    function onUp() {
      wrap.setAttribute("data-dragging", "false");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    }
    function onDown(e) {
      wrap.setAttribute("data-dragging", "true");
      onMove(e);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
    }
    track.addEventListener("mousedown", onDown);
    track.addEventListener("touchstart", onDown, { passive: false });
    render();
    return { get: () => v, set: (nv, fire = true) => setValue(nv, fire) };
  }
  const leverageMock = document.querySelector('[data-mock="leverage"]');
  if (leverageMock) {
    const PRICE = 0.62;
    const state = { side: "long", leverage: 3, rollOver: true, size: 500 };
    const sizeInput = leverageMock.querySelector('[data-input="size"]');
    const orderValueOut = leverageMock.querySelector(
      '[data-out="order-value"]',
    );
    const liqPriceOut = leverageMock.querySelector('[data-out="liq-price"]');
    const warhorseOut = leverageMock.querySelector(
      '[data-out="leverage-warhorse"]',
    );
    const readoutOut = leverageMock.querySelector(
      '[data-out="leverage-readout"]',
    );
    function fmtMoney(n) {
      return "$" + Math.round(n).toLocaleString();
    }
    function recalcLeverage() {
      orderValueOut.textContent = fmtMoney(state.size * state.leverage);
      let liq =
        state.side === "long"
          ? PRICE * (1 - 1 / state.leverage)
          : PRICE * (1 + 1 / state.leverage);
      liq = Math.max(0, Math.min(0.99, liq));
      liqPriceOut.textContent = "$" + liq.toFixed(2);
      const sideMultiplier = state.side === "long" ? 0.1 : 0.15;
      const feePct = Math.pow(state.leverage, 2) * sideMultiplier;
      warhorseOut.textContent = feePct.toFixed(2) + "%";
      readoutOut.textContent = state.leverage + "×";
    }
    sizeInput.addEventListener("input", () => {
      const raw = parseFloat(sizeInput.value.replace(/,/g, "")) || 0;
      state.size = Math.max(0, raw);
      recalcLeverage();
    });
    sizeInput.addEventListener("blur", () => {
      sizeInput.value = state.size ? state.size.toString() : "";
    });
    makeSlider(leverageMock.querySelector('[data-role="slider-wrap"]'), {
      min: 1,
      max: 5,
      value: 3,
      step: 1,
      onChange: (v) => {
        state.leverage = v;
        recalcLeverage();
      },
    });
    const tabs = leverageMock.querySelectorAll("[data-tab]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("hiw-mock-tab-active"));
        tab.classList.add("hiw-mock-tab-active");
        state.side = tab.dataset.tab;
        recalcLeverage();
      });
    });
    const checkboxRow = leverageMock.querySelector(
      '[data-role="checkbox-row"]',
    );
    const checkbox = leverageMock.querySelector('[data-role="checkbox"]');
    checkboxRow.addEventListener("click", () => {
      state.rollOver = !state.rollOver;
      checkbox.classList.toggle("hiw-mock-checkbox-on", state.rollOver);
    });
    recalcLeverage();
  }
  const borrowMock = document.querySelector('[data-mock="borrow"]');
  if (borrowMock) {
    const COLLATERAL = 12400;
    const COLLATERAL_PRICE = 0.62;
    const LIQ_LTV = 0.95;
    const MAX_LTV = 0.9;
    const FEE_FLOOR_PCT = 0.05;
    const state = { borrowAmount: 8680, epochDays: 7 };
    const borrowInput = borrowMock.querySelector('[data-input="borrow"]');
    const liqPriceOut = borrowMock.querySelector(
      '[data-out="borrow-liq-price"]',
    );
    const warhorseOut = borrowMock.querySelector(
      '[data-out="borrow-warhorse"]',
    );
    const ltvReadoutOut = borrowMock.querySelector('[data-out="ltv-readout"]');
    function ltvPctFromAmount() {
      return Math.max(
        0,
        Math.min(MAX_LTV * 100, (state.borrowAmount / COLLATERAL) * 100),
      );
    }
    function recalcBorrow() {
      const ltvPct = ltvPctFromAmount();
      const ltv = ltvPct / 100;
      const liqPrice = ltv > 0 ? COLLATERAL_PRICE * (ltv / LIQ_LTV) : 0;
      liqPriceOut.textContent = liqPrice > 0 ? "$" + liqPrice.toFixed(2) : "—";
      const epochScale = Math.sqrt(state.epochDays / 7);
      const raw = Math.pow(ltv, 3) * 5 * epochScale;
      const feePct = Math.max(FEE_FLOOR_PCT, raw);
      warhorseOut.textContent = feePct.toFixed(2) + "%";
      ltvReadoutOut.textContent = Math.round(ltvPct) + "%";
    }
    const borrowSlider = makeSlider(
      borrowMock.querySelector('[data-role="slider-wrap"]'),
      {
        min: 0,
        max: MAX_LTV * 100,
        value: 70,
        step: 1,
        onChange: (v) => {
          state.borrowAmount = COLLATERAL * (v / 100);
          borrowInput.value = Math.round(state.borrowAmount).toLocaleString();
          recalcBorrow();
        },
      },
    );
    borrowInput.addEventListener("input", () => {
      const raw = parseFloat(borrowInput.value.replace(/,/g, "")) || 0;
      const max = COLLATERAL * MAX_LTV;
      const capped = Math.max(0, Math.min(max, raw));
      state.borrowAmount = capped;
      if (raw > max) {
        borrowInput.value = Math.round(capped).toLocaleString();
      }
      borrowSlider.set(ltvPctFromAmount(), false);
      recalcBorrow();
    });
    borrowInput.addEventListener("blur", () => {
      borrowInput.value = Math.round(state.borrowAmount).toLocaleString();
    });
    const epochPills = borrowMock.querySelectorAll("[data-epoch]");
    epochPills.forEach((pill) => {
      pill.addEventListener("click", () => {
        epochPills.forEach((p) => p.classList.remove("hiw-mock-pill-active"));
        pill.classList.add("hiw-mock-pill-active");
        state.epochDays = parseInt(pill.dataset.epoch, 10);
        recalcBorrow();
      });
    });
    const borrowCheckboxRow = borrowMock.querySelector(
      '[data-role="borrow-checkbox-row"]',
    );
    const borrowCheckbox = borrowMock.querySelector(
      '[data-role="borrow-checkbox"]',
    );
    if (borrowCheckboxRow && borrowCheckbox) {
      let autoRoll = true;
      borrowCheckboxRow.addEventListener("click", () => {
        autoRoll = !autoRoll;
        borrowCheckbox.classList.toggle("hiw-mock-checkbox-on", autoRoll);
      });
    }
    recalcBorrow();
  }
  const safetySection = document.getElementById("safety");
  const safetySlideshow = document.querySelector("[data-slideshow]");
  if (safetySection && safetySlideshow) {
    const safetyTitleEl = safetySection.querySelector(".safety-title");
    const safetyEyebrowEl = safetySection.querySelector(".safety-eyebrow");
    const SAFETY_TITLE_TEXT = safetyTitleEl ? safetyTitleEl.textContent : "";
    if (safetyTitleEl) safetyTitleEl.textContent = "";
    if (safetyEyebrowEl) safetyEyebrowEl.style.opacity = "0";
    safetySlideshow.style.opacity = "0";
    const slides = Array.from(
      safetySlideshow.querySelectorAll(".safety-slide"),
    );
    const dots = Array.from(safetySlideshow.querySelectorAll(".safety-dot"));
    const ADVANCE_MS = 7000;
    let current = 0;
    let timer = null;
    let paused = false;
    function show(idx) {
      current = ((idx % slides.length) + slides.length) % slides.length;
      slides.forEach((s, i) =>
        s.classList.toggle("safety-slide-active", i === current),
      );
      dots.forEach((d, i) =>
        d.classList.toggle("safety-dot-active", i === current),
      );
    }
    function next() {
      show(current + 1);
    }
    function start() {
      stop();
      if (paused) return;
      timer = setInterval(next, ADVANCE_MS);
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    dots.forEach((dot, i) => {
      dot.addEventListener("click", () => {
        show(i);
        start();
      });
    });
    safetySlideshow.addEventListener("mouseenter", () => {
      paused = true;
      stop();
    });
    safetySlideshow.addEventListener("mouseleave", () => {
      paused = false;
      start();
    });
    let safetyRevealed = false;
    async function revealSafety() {
      if (safetyRevealed) return;
      safetyRevealed = true;
      if (safetyEyebrowEl) {
        anime({
          targets: safetyEyebrowEl,
          opacity: [0, 1],
          translateY: [6, 0],
          duration: 450,
          easing: "easeOutCubic",
        });
      }
      if (safetyTitleEl) {
        scrambleText(safetyTitleEl, SAFETY_TITLE_TEXT, 550, "in");
      }
      await new Promise((r) => setTimeout(r, 280));
      anime({
        targets: safetySlideshow,
        opacity: [0, 1],
        translateY: [14, 0],
        duration: 600,
        easing: "easeOutCubic",
      });
      start();
    }
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) revealSafety();
          });
        },
        { threshold: 0.2 },
      );
      io.observe(safetySection);
    } else {
      revealSafety();
    }
  }
})();
