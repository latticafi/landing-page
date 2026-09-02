(() => {
  const CHARS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&";
  const activeAnimations = new WeakMap();

  function cancelTextAnimation(el) {
    const animation = activeAnimations.get(el);
    if (!animation) return false;

    activeAnimations.delete(el);
    animation.cancel();
    return true;
  }

  function currentFrame(el, targetText) {
    const displayedText = el.textContent || "";
    let frame = "";

    for (let i = 0; i < targetText.length; i += 1) {
      const targetCharacter = targetText[i];
      if (targetCharacter === " " || targetCharacter === "\n") {
        frame += targetCharacter;
        continue;
      }

      const displayedCharacter = displayedText[i];
      frame += displayedCharacter && !/\s/.test(displayedCharacter)
        ? displayedCharacter
        : "\u00A0";
    }

    return frame;
  }

  function scrambleText(el, targetText, duration, direction) {
    cancelTextAnimation(el);
    const sourceText = direction === "out" ? currentFrame(el, targetText) : targetText;

    return new Promise((resolve) => {
      const len = targetText.length;
      let startTime = null;
      let settled = false;
      const animation = {
        cancel() {
          if (settled) return;
          settled = true;
          resolve();
        },
      };
      activeAnimations.set(el, animation);

      function finish() {
        if (settled) return;
        settled = true;
        if (activeAnimations.get(el) === animation) activeAnimations.delete(el);
        el.textContent = direction === "in" ? targetText : "";
        resolve();
      }

      function tick(ts) {
        if (activeAnimations.get(el) !== animation) return;
        if (startTime === null) startTime = ts;
        const progress = Math.min(1, (ts - startTime) / duration);
        let result = "";

        for (let i = 0; i < len; i += 1) {
          if (targetText[i] === " " || targetText[i] === "\n") {
            result += targetText[i];
            continue;
          }

          const characterProgress =
            direction === "in"
              ? (progress - (i / len) * 0.5) / 0.5
              : (progress - (i / len) * 0.4) / 0.6;

          if (direction === "in") {
            if (characterProgress >= 1) result += targetText[i];
            else if (characterProgress > 0) {
              result += CHARS[Math.floor(Math.random() * CHARS.length)];
            } else result += "\u00A0";
          } else if (sourceText[i] === "\u00A0") result += "\u00A0";
          else if (characterProgress >= 1) result += "\u00A0";
          else if (characterProgress > 0) {
            result += CHARS[Math.floor(Math.random() * CHARS.length)];
          } else result += sourceText[i];
        }

        el.textContent = result;

        if (progress < 1) requestAnimationFrame(tick);
        else finish();
      }

      requestAnimationFrame(tick);
    });
  }

  function scrambleHeroTwoTone(el, line1, line2, duration, direction) {
    cancelTextAnimation(el);
    const full = `${line1}\n${line2}`;
    const sourceText = direction === "out" ? currentFrame(el, full) : full;

    return new Promise((resolve) => {
      const len = full.length;
      const splitAt = line1.length;
      let startTime = null;
      let settled = false;
      const animation = {
        cancel() {
          if (settled) return;
          settled = true;
          resolve();
        },
      };
      activeAnimations.set(el, animation);

      function finish() {
        if (settled) return;
        settled = true;
        if (activeAnimations.get(el) === animation) activeAnimations.delete(el);
        if (direction === "in") {
          el.innerHTML = `<span class="dim">${line1}</span>\n${line2.replace("10X", '<span class="bold">10X</span>')}`;
        } else el.innerHTML = "";
        resolve();
      }

      function tick(ts) {
        if (activeAnimations.get(el) !== animation) return;
        if (startTime === null) startTime = ts;
        const progress = Math.min(1, (ts - startTime) / duration);
        let part1 = "";
        let part2 = "";

        for (let i = 0; i < len; i += 1) {
          const character = full[i];

          if (character === " " || character === "\n") {
            if (i <= splitAt) part1 += character === "\n" ? "" : character;
            else part2 += character;
            continue;
          }

          const characterProgress =
            direction === "in"
              ? (progress - (i / len) * 0.5) / 0.5
              : (progress - (i / len) * 0.4) / 0.6;
          let output;

          if (direction === "in") {
            if (characterProgress >= 1) output = character;
            else if (characterProgress > 0) {
              output = CHARS[Math.floor(Math.random() * CHARS.length)];
            } else output = "\u00A0";
          } else if (sourceText[i] === "\u00A0") output = "\u00A0";
          else if (characterProgress >= 1) output = "\u00A0";
          else if (characterProgress > 0) {
            output = CHARS[Math.floor(Math.random() * CHARS.length)];
          } else output = sourceText[i];

          if (i < splitAt) part1 += output;
          else if (i > splitAt) part2 += output;
        }

        el.innerHTML = `<span class="dim">${part1}</span>\n${part2}`;

        if (progress < 1) requestAnimationFrame(tick);
        else finish();
      }

      requestAnimationFrame(tick);
    });
  }

  window.LatticaTextAnimations = Object.freeze({
    cancelTextAnimation,
    scrambleHeroTwoTone,
    scrambleText,
  });
})();
