import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { afterEach } from "node:test";

const projectRoot = new URL("..", import.meta.url);
const fixtureRoots = new Set();

afterEach(async () => {
  const roots = [...fixtureRoots];
  fixtureRoots.clear();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "lattica-blog-"));
  fixtureRoots.add(root);
  const contentDir = join(root, "content", "blog");
  const publicDir = join(root, "public");

  await mkdir(join(contentDir, "images"), { recursive: true });
  await mkdir(publicDir, { recursive: true });
  await writeFile(
    join(publicDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://lattica.finance/</loc></url>
</urlset>
`,
  );
  await writeFile(
    join(contentDir, "market-structure.md"),
    `---
title: "Market Structure"
author: "Steve"
date: "2026-08-18"
order: 1
---

# Market Structure

Prediction markets need deeper liquidity before anything else.

## Credit

Credit unlocks long-lived positions.

| Layer | Purpose |
| --- | --- |
| Credit | Capital efficiency |

![Liquidity chart](images/liquidity.png)

A useful footnote.[^1]

[^1]: Supporting context.
`,
  );
  await writeFile(
    join(contentDir, "images", "liquidity.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );

  return { root, contentDir, publicDir };
}

function runBuild(root) {
  return spawnSync(
    process.execPath,
    [
      new URL("../scripts/build-blog.js", import.meta.url).pathname,
      "--root",
      root,
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );
}

test("builds a blog index and article from Markdown", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);

  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  assert.match(index, /href="\/blog\/market-structure\/"/);
  assert.match(index, /Prediction markets need deeper liquidity/);
  assert.match(index, /class="skip-link" href="#blog-content"/);
  assert.match(article, /<h1[^>]*>[\s\S]*Market Structure[\s\S]*<\/h1>/);
  assert.match(article, /class="skip-link" href="#article-content"/);
  assert.match(article, /<h2[^>]*>Credit<\/h2>/);
  assert.match(article, /<table>/);
  assert.match(article, /class="footnotes"/);
  assert.match(article, /src="\/blog\/images\/liquidity.png"/);
  assert.match(
    article,
    /<img src="\/blog\/images\/liquidity.png" alt="Liquidity chart" loading="lazy" decoding="async" width="1" height="1">/,
  );
  assert.doesNotMatch(article, /<h1>Market Structure<\/h1>[\s\S]*<h1>/);
});

test("renders the landing lattice background on blog indexes and articles", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  for (const page of [index, article]) {
    assert.match(page, /<canvas id="lattice"><\/canvas>/);
    assert.match(page, /<div class="vignette"><\/div>/);
    assert.match(page, /src="\/assets\/js\/lattice-bg\.js"/);
  }
});

test("paints blog pages dark before external stylesheets load", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  for (const page of [index, article]) {
    const externalStylesheet = page.indexOf('<link rel="stylesheet"');
    const criticalStyles = page.slice(0, externalStylesheet);

    assert.match(criticalStyles, /html,\s*body\s*{[^}]*background:\s*#090909;/s);
  }
});

test("keeps blog text unpainted before its stylesheets load", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  for (const page of [index, article]) {
    const firstStylesheet = page.indexOf('<link rel="stylesheet"');
    const criticalStyles = page.slice(0, firstStylesheet);

    assert.match(
      criticalStyles,
      /html,\s*body\s*{[^}]*color:\s*transparent;/s,
    );
    assert.match(criticalStyles, /a\s*{[^}]*color:\s*inherit;/s);
  }
});

test("equips blog indexes and articles with the shared text reveal", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  for (const page of [index, article]) {
    assert.match(page, /<body[^>]*data-blog-animate/);
    assert.match(page, /data-blog-scramble/);
    assert.ok(
      page.indexOf('/assets/js/text-scramble.js') <
        page.indexOf('/assets/js/blog-animations.js'),
    );
  }
});

test("renders the landing navigation shell on blog pages", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  for (const page of [index, article]) {
    const navStart = page.indexOf('<nav class="site-nav"');
    const navEnd = page.indexOf("</nav>", navStart);
    const nav = page.slice(navStart, navEnd);

    assert.match(nav, /class="logo"/);
    assert.match(nav, /class="nav-end"/);
    assert.equal((nav.match(/class="nav-text-btn"/g) || []).length, 5);
    assert.match(nav, /class="nav-x-link"/);
    assert.match(nav, /class="nav-menu-btn"/);
    assert.match(page, /id="mobile-menu"/);
  }
});

test("marks generated blog content for persistent page navigation", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  for (const page of [index, article]) {
    assert.match(page, /data-page-content/);
    assert.match(page, /src="\/assets\/js\/site-router\.js"/);
    assert.ok(
      page.indexOf('/assets/js/blog-animations.js') <
        page.indexOf('/assets/js/site-router.js'),
    );
  }
});

test("renders dated metadata from article frontmatter", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  assert.match(index, />By Steve · August 18, 2026 · 1 min read</);
  assert.match(
    article,
    /<p class="article-meta" data-blog-scramble>By Steve · August 18, 2026 · 1 min read<\/p>/,
  );
  assert.match(
    article,
    /<p class="blog-eyebrow" data-blog-scramble>Article<\/p>/,
  );
});

test("renders the requested blog intro and article back label", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  assert.match(
    index,
    /<p data-blog-scramble>The latest headlines, thoughts, and research by the team\.<\/p>/,
  );
  assert.match(article, />← BACK<\/a>/);
  assert.doesNotMatch(article, /All articles/);
  assert.match(
    index,
    /<p class="blog-eyebrow" data-blog-scramble>From Lattica<\/p>/,
  );
  assert.match(
    article,
    /<p class="blog-eyebrow" data-blog-scramble>Article<\/p>/,
  );
});

test("orders the blog index by frontmatter order", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "alpha.md"),
    `---
title: "Alpha"
author: "Steve"
date: "2026-08-19"
order: 2
---

# Alpha

Second article.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");

  assert.ok(index.indexOf("Market Structure") < index.indexOf("Alpha"));
});

test("rejects an article without a frontmatter title", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "untitled.md"),
    `---
order: 2
---

Article without a title.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /untitled\.md requires a frontmatter title/);
});

test("rejects an article without a frontmatter author", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "market-structure.md"),
    `---
title: "Market Structure"
order: 1
---

Article without an author.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /market-structure\.md requires a frontmatter author/);
});

test("rejects a non-string frontmatter author", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "market-structure.md"),
    `---
title: "Market Structure"
author:
  - Steve
order: 1
---

Article with an invalid author.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /market-structure\.md requires a nonempty string author/,
  );
});

test("rejects an article that references a missing local image", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "missing-image.md"),
    `---
title: "Missing Image"
author: "Steve"
date: "2026-08-19"
order: 2
---

# Missing Image

![Missing chart](images/missing.png)
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing-image\.md references missing image images\/missing\.png/);
});

test("rejects an image path that escapes the blog image directory", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "unsafe-image.md"),
    `---
title: "Unsafe Image"
author: "Steve"
date: "2026-08-19"
order: 2
---

# Unsafe Image

![Private file](images/../../private.png)
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe-image\.md contains unsafe image path/);
});

test("rejects unreferenced symlinks in the blog image directory", async () => {
  const fixture = await createFixture();
  const outsideFile = join(fixture.root, "outside-secret.txt");

  await writeFile(outsideFile, "must not be copied");
  await symlink(
    outsideFile,
    join(fixture.contentDir, "images", "unused-leak.txt"),
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /blog image directory contains unsupported entry unused-leak\.txt/,
  );
  await assert.rejects(access(join(fixture.publicDir, "blog")));
});

test("rejects non-image files in the blog image directory", async () => {
  const fixture = await createFixture();

  await writeFile(
    join(fixture.contentDir, "images", "unused.html"),
    "<script>document.body.textContent = 'unexpected'</script>",
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /blog image directory contains unsupported image unused\.html/,
  );
  await assert.rejects(access(join(fixture.publicDir, "blog")));
});

test("shows the derived reading time on the listing and article", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(join(fixture.publicDir, "blog", "index.html"), "utf8");
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  assert.match(index, /1 min read</);
  assert.match(article, /1 min read</);
});

test("adds the blog index and articles to the sitemap", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const sitemap = await readFile(join(fixture.publicDir, "sitemap.xml"), "utf8");

  assert.match(sitemap, /<loc>https:\/\/lattica\.finance\/blog\/<\/loc>/);
  assert.match(
    sitemap,
    /<loc>https:\/\/lattica\.finance\/blog\/market-structure\/<\/loc>\s*<lastmod>2026-08-18<\/lastmod>/,
  );
});

test("rejects an article without a frontmatter date", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "market-structure.md"),
    `---
title: "Market Structure"
author: "Steve"
order: 1
---

Article without a date.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /market-structure\.md requires a valid ISO frontmatter date/,
  );
});

test("rejects an impossible frontmatter date", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "market-structure.md"),
    `---
title: "Market Structure"
author: "Steve"
date: "2026-02-30"
order: 1
---

Article with an impossible date.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /market-structure\.md requires a valid ISO frontmatter date/,
  );
});

test("emits article-specific social and canonical metadata", async () => {
  const fixture = await createFixture();

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  assert.match(article, /<meta property="og:type" content="article" \/>/);
  assert.match(article, /<meta property="og:title" content="Market Structure — Lattica" \/>/);
  assert.match(
    article,
    /<meta property="og:url" content="https:\/\/lattica\.finance\/blog\/market-structure\/" \/>/,
  );
  assert.match(article, /<meta name="twitter:card" content="summary_large_image" \/>/);
});

test("limits generated descriptions to a search-friendly length", async () => {
  const fixture = await createFixture();
  const longParagraph = "Liquidity compounds when traders can reuse their capital efficiently. ".repeat(5);
  await writeFile(
    join(fixture.contentDir, "market-structure.md"),
    `---
title: "Market Structure"
author: "Steve"
date: "2026-08-18"
order: 1
---

# Market Structure

${longParagraph}
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );
  const description = article.match(/<meta name="description" content="([^"]+)" \/>/)?.[1];

  assert.ok(description);
  assert.ok(description.length <= 160);
  assert.match(description, /…$/);
});

test("removes stale pages from a previously generated blog", async () => {
  const fixture = await createFixture();
  const firstBuild = runBuild(fixture.root);
  const blogDir = join(fixture.publicDir, "blog");
  const stalePage = join(blogDir, "retired-article", "index.html");

  assert.equal(firstBuild.status, 0, firstBuild.stderr);
  await writeFile(join(blogDir, ".generated-by-build-blog"), "");
  await mkdir(join(blogDir, "retired-article"), { recursive: true });
  await writeFile(stalePage, "stale");

  const secondBuild = runBuild(fixture.root);

  assert.equal(secondBuild.status, 0, secondBuild.stderr);
  await assert.rejects(access(stalePage));
});

test("refuses to overwrite an unmanaged public blog directory", async () => {
  const fixture = await createFixture();
  const blogDir = join(fixture.publicDir, "blog");
  const manualPage = join(blogDir, "manual.html");
  await mkdir(blogDir, { recursive: true });
  await writeFile(manualPage, "manual");

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to replace unmanaged public\/blog directory/);
  assert.equal(await readFile(manualPage, "utf8"), "manual");
});

test("rejects a filename whose slug could escape the blog output directory", async () => {
  const fixture = await createFixture();
  const homepage = join(fixture.publicDir, "index.html");
  await writeFile(homepage, "homepage");
  await writeFile(
    join(fixture.contentDir, "...md"),
    `---
title: "Unsafe Slug"
author: "Steve"
order: 2
---

This article must not escape the blog directory.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.\.\.md has unsafe slug/);
  assert.equal(await readFile(homepage, "utf8"), "homepage");
});

test("rejects a missing image declared with reference Markdown", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "reference-image.md"),
    `---
title: "Reference Image"
author: "Steve"
date: "2026-08-19"
order: 2
---

# Reference Image

![Missing chart][chart]

[chart]: images/missing-reference.png
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /reference-image\.md references missing image images\/missing-reference\.png/,
  );
});

test("rejects a non-string frontmatter title", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "invalid-title.md"),
    `---
title:
  - Invalid
  - Title
author: "Steve"
order: 2
---

Invalid title article.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid-title\.md requires a nonempty string title/);
});

test("rejects a non-string frontmatter description", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "invalid-description.md"),
    `---
title: "Invalid Description"
author: "Steve"
date: "2026-08-19"
description:
  text: "Not a string"
order: 2
---

Invalid description article.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /invalid-description\.md description must be a nonempty string/,
  );
});

test("rejects a frontmatter order that is not a positive integer", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "invalid-order.md"),
    `---
title: "Invalid Order"
author: "Steve"
date: "2026-08-19"
order: first
---

Invalid order article.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid-order\.md order must be a positive integer/);
});

test("preserves the last complete blog when staging fails", async () => {
  const fixture = await createFixture();
  const firstBuild = runBuild(fixture.root);
  const sentinel = join(fixture.publicDir, "blog", "last-known-good.txt");
  const image = join(fixture.contentDir, "images", "liquidity.png");

  assert.equal(firstBuild.status, 0, firstBuild.stderr);
  await writeFile(sentinel, "last-known-good");
  await chmod(image, 0o000);

  try {
    const secondBuild = runBuild(fixture.root);

    assert.equal(secondBuild.status, 1);
    assert.equal(
      await readFile(sentinel, "utf8").catch(() => "missing"),
      "last-known-good",
    );
  } finally {
    await chmod(image, 0o600);
  }
});

test("derives descriptions from the first paragraph instead of a heading", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.contentDir, "market-structure.md"),
    `---
title: "Market Structure"
author: "Steve"
date: "2026-08-18"
order: 1
---

# Market Structure

## Framing

**Prediction markets** need [deeper liquidity](https://example.com) before anything else.
`,
  );

  const result = runBuild(fixture.root);

  assert.equal(result.status, 0, result.stderr);
  const article = await readFile(
    join(fixture.publicDir, "blog", "market-structure", "index.html"),
    "utf8",
  );

  assert.match(
    article,
    /<meta name="description" content="Prediction markets need deeper liquidity before anything else\." \/>/,
  );
});
