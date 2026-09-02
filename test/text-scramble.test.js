import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

async function loadAnimations() {
  const script = await readFile(
    new URL("../public/assets/js/text-scramble.js", import.meta.url),
    "utf8",
  );
  const frames = [];
  const window = {};
  const requestAnimationFrame = (callback) => frames.push(callback);

  runInNewContext(script, { requestAnimationFrame, window });

  return { animations: window.LatticaTextAnimations, frames };
}

test("cancels an in-progress text reveal so navigation can reverse it", async () => {
  const { animations, frames } = await loadAnimations();
  const element = { textContent: "" };
  const reveal = animations.scrambleText(element, "Header", 100, "in");

  frames.shift()(10);
  frames.shift()(60);
  const interruptedText = element.textContent;

  animations.cancelTextAnimation(element);
  await reveal;

  assert.notEqual(interruptedText, "Header");
  assert.equal(element.textContent, interruptedText);
});

test("starts an unload from the currently rendered text frame", async () => {
  const { animations, frames } = await loadAnimations();
  const element = { textContent: "Ab\u00a0\u00a0" };
  const unload = animations.scrambleText(element, "Able", 100, "out");

  frames.shift()(10);
  assert.equal(element.textContent, "Ab\u00a0\u00a0");

  frames.shift()(110);
  await unload;
  assert.equal(element.textContent, "");
});
