import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";

const SITE_ORIGIN = "https://lattica.finance";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createMarkdown() {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  }).use(footnote);
  const renderImage = markdown.renderer.rules.image;

  markdown.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const sourceIndex = token.attrIndex("src");

    if (sourceIndex >= 0) {
      const source = token.attrs[sourceIndex][1];
      const dimensions = env.imageDimensions?.get(source);

      token.attrSet("loading", "lazy");
      token.attrSet("decoding", "async");

      if (dimensions) {
        token.attrSet("width", String(dimensions.width));
        token.attrSet("height", String(dimensions.height));
      }

      if (source.startsWith("images/")) {
        token.attrs[sourceIndex][1] = `/blog/${source}`;
      }
    }

    return renderImage
      ? renderImage(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };

  return markdown;
}

function firstParagraph(markdown, source) {
  const tokens = markdown.parse(source, {});

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "paragraph_open") continue;

    const inline = tokens[index + 1];
    const text = (inline?.children || [])
      .map((token) => {
        if (token.type === "text" || token.type === "code_inline") {
          return token.content;
        }

        if (token.type === "softbreak" || token.type === "hardbreak")
          return " ";
        return "";
      })
      .join("")
      .replaceAll(/\s+/g, " ")
      .trim();

    if (text) return text;
  }

  return "";
}

function withoutLeadingTitle(source) {
  return source.replace(/^\s*#\s+[^\n]+\n+/, "");
}

function readingTime(source) {
  const words = source.match(/\p{L}[\p{L}\p{N}'’-]*/gu) || [];
  return Math.max(1, Math.ceil(words.length / 220));
}

function summarize(value, maxLength = 160) {
  const normalized = value.replaceAll(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  const candidate = normalized.slice(0, maxLength - 1);
  const boundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, boundary > 0 ? boundary : candidate.length).trimEnd()}…`;
}

function imageSources(markdown, source) {
  const sources = [];

  function visit(tokens) {
    for (const token of tokens) {
      if (token.type === "image") {
        const sourceValue = token.attrGet("src");
        if (sourceValue) sources.push(sourceValue);
      }

      if (token.children) visit(token.children);
    }
  }

  visit(markdown.parse(source, {}));
  return sources;
}

async function validateImages(file, source, contentDir, markdown) {
  const imageRoot = resolve(contentDir, "images");
  const canonicalImageRoot = await realpath(imageRoot);
  const imageDimensions = new Map();

  for (const image of imageSources(markdown, source)) {
    if (/^https?:\/\//i.test(image)) continue;

    if (!image.startsWith("images/")) {
      throw new Error(`${file} contains unsupported local image path ${image}`);
    }

    const imagePath = resolve(contentDir, image);

    if (!imagePath.startsWith(`${imageRoot}${sep}`)) {
      throw new Error(`${file} contains unsafe image path ${image}`);
    }

    try {
      const canonicalImagePath = await realpath(imagePath);

      if (!canonicalImagePath.startsWith(`${canonicalImageRoot}${sep}`)) {
        throw new Error(`${file} contains unsafe image path ${image}`);
      }

      if (!(await stat(canonicalImagePath)).isFile()) {
        throw new Error(`${file} image must be a file ${image}`);
      }

      const data = await readFile(canonicalImagePath);
      const pngSignature = "89504e470d0a1a0a";

      if (
        data.length >= 24 &&
        data.subarray(0, 8).toString("hex") === pngSignature &&
        data.subarray(12, 16).toString("ascii") === "IHDR"
      ) {
        imageDimensions.set(image, {
          width: data.readUInt32BE(16),
          height: data.readUInt32BE(20),
        });
      }
    } catch (error) {
      if (error.message?.startsWith(file)) throw error;
      throw new Error(`${file} references missing image ${image}`);
    }
  }

  return imageDimensions;
}

async function validateImageTree(
  imageRoot,
  currentDir = imageRoot,
  prefix = "",
) {
  if (currentDir === imageRoot) {
    const rootStat = await lstat(imageRoot);

    if (!rootStat.isDirectory()) {
      throw new Error("blog image directory must be a directory");
    }
  }

  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await validateImageTree(imageRoot, entryPath, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      throw new Error(
        `blog image directory contains unsupported entry ${relativePath}`,
      );
    }

    const data = await readFile(entryPath);
    const extension = extname(entry.name).toLowerCase();
    const isPng =
      extension === ".png" &&
      data.length >= 8 &&
      data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    const isJpeg =
      (extension === ".jpg" || extension === ".jpeg") &&
      data.length >= 4 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[data.length - 2] === 0xff &&
      data[data.length - 1] === 0xd9;
    const gifHeader = data.subarray(0, 6).toString("ascii");
    const isGif =
      extension === ".gif" &&
      (gifHeader === "GIF87a" || gifHeader === "GIF89a");
    const isWebp =
      extension === ".webp" &&
      data.length >= 12 &&
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP";

    if (!isPng && !isJpeg && !isGif && !isWebp) {
      throw new Error(
        `blog image directory contains unsupported image ${relativePath}`,
      );
    }
  }
}

function pageHead({ title, description, canonical, type }) {
  const safeTitle = escapeHtml(`${title} — Lattica`);
  const safeDescription = escapeHtml(description);
  const safeCanonical = escapeHtml(`${SITE_ORIGIN}${canonical}`);

  return `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}" />
    <link rel="canonical" href="${safeCanonical}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#090909" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="Lattica" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${safeCanonical}" />
    <meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@Lattica" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <style>html, body { background: #090909; color: transparent; } a { color: inherit; }</style>
    <link rel="stylesheet" href="/assets/css/styles.css" />
    <link rel="stylesheet" href="/assets/css/blog.css" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <script defer src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=Space+Mono:wght@400&display=swap" rel="stylesheet" />`;
}

function blogBackground() {
  return `
    <canvas id="lattice"></canvas>
    <div class="vignette"></div>`;
}

function blogScripts() {
  return `
    <script defer src="/assets/js/lattice-bg.js"></script>
    <script defer src="/assets/js/text-scramble.js"></script>
    <script defer src="/assets/js/blog-animations.js"></script>
    <script defer src="/assets/js/site-router.js"></script>`;
}

function blogNav() {
  return `
    <nav class="site-nav" aria-label="Primary navigation">
      <a class="logo" id="logo-btn" href="/" data-view="home">
        <img src="/lattica-text-white-logo.png" alt="Lattica" width="101" height="28" />
      </a>
      <ul class="nav-links"></ul>
      <div class="nav-end">
        <a class="nav-text-btn" id="home-btn" href="/" data-view="home">Home</a>
        <a class="nav-text-btn" id="whitepapers-btn" href="/whitepapers" data-view="whitepapers">Whitepapers</a>
        <a class="nav-text-btn" id="waitlist-btn" href="/waitlist" data-view="waitlist">Waitlist</a>
        <a class="nav-text-btn" id="careers-btn" href="/careers" data-view="careers">Careers</a>
        <a class="nav-text-btn" href="/blog/" aria-current="page">Blog</a>
        <a
          class="nav-x-link"
          href="https://x.com/Lattica"
          target="_blank"
          rel="noopener"
          aria-label="Lattica on X"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
      </div>
      <button
        class="nav-menu-btn"
        id="nav-menu-btn"
        type="button"
        aria-label="Open menu"
        aria-expanded="false"
      >
        <svg class="icon-open" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
        <svg class="icon-close" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </nav>
    <div
      class="mobile-menu"
      id="mobile-menu"
      role="dialog"
      aria-modal="true"
      aria-hidden="true"
    >
      <a class="mobile-menu-item" href="/" data-view="home">Home</a>
      <a class="mobile-menu-item" href="/whitepapers" data-view="whitepapers">Whitepapers</a>
      <a class="mobile-menu-item" href="/waitlist" data-view="waitlist">Waitlist</a>
      <a class="mobile-menu-item" href="/careers" data-view="careers">Careers</a>
      <a class="mobile-menu-item active" href="/blog/" aria-current="page">Blog</a>
      <a
        class="mobile-menu-x"
        href="https://x.com/LatticaFinance"
        target="_blank"
        rel="noopener"
        aria-label="Lattica on X"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
    </div>`;
}

function articlePage(article) {
  return `<!doctype html>
<html lang="en">
  <head>${pageHead({
    title: article.title,
    description: article.description,
    canonical: `/blog/${article.slug}/`,
    type: "article",
  })}
  </head>
  <body class="blog-page article-page" data-blog-animate>
    ${blogBackground()}
    ${blogNav()}
    <div data-page-content data-page-kind="blog" data-blog-animate>
      <a class="skip-link" href="#article-content">Skip to article</a>
      <main class="article-shell" id="article-content">
      <a class="blog-back" href="/blog/">← BACK</a>
      <article class="article-layout">
        <header class="article-header">
          <p class="blog-eyebrow" data-blog-scramble>Article</p>
          <h1><span data-blog-scramble>${escapeHtml(article.title)}</span></h1>
          <p class="article-meta" data-blog-scramble>By ${escapeHtml(article.author)} · ${article.readingTime} min read</p>
        </header>
        <div class="article-body">${article.html}</div>
      </article>
      </main>
    </div>
    ${blogScripts()}
  </body>
</html>
`;
}

function indexPage(articles) {
  const cards = articles
    .map(
      (article) => `
        <a class="article-card" href="/blog/${article.slug}/">
          <span class="article-card-node" aria-hidden="true"></span>
          <span class="article-card-copy">
            <span class="article-card-title">${escapeHtml(article.title)}</span>
            <span class="article-card-description">${escapeHtml(article.description)}</span>
            <span class="article-card-meta">By ${escapeHtml(article.author)} · ${article.readingTime} min read</span>
          </span>
          <span class="article-card-arrow" aria-hidden="true">↗</span>
        </a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>${pageHead({
    title: "Blog",
    description: "Ideas and research on prediction markets from Lattica.",
    canonical: "/blog/",
    type: "website",
  })}
  </head>
  <body class="blog-page blog-index-page" data-blog-animate>
    ${blogBackground()}
    ${blogNav()}
    <div data-page-content data-page-kind="blog" data-blog-animate>
      <a class="skip-link" href="#blog-content">Skip to articles</a>
      <main class="blog-index" id="blog-content">
      <header class="blog-index-header">
        <p class="blog-eyebrow" data-blog-scramble>From Lattica</p>
        <h1><span data-blog-scramble>Blog, News,</span><br /><span data-blog-scramble>and Articles</span></h1>
        <p data-blog-scramble>The latest headlines, thoughts, and research by the team.</p>
      </header>
      <section class="article-list" aria-label="Articles">${cards}
      </section>
      </main>
    </div>
    ${blogScripts()}
  </body>
</html>
`;
}

function sitemap(articles) {
  const articleUrls = articles
    .map(
      (article) => `  <url>
    <loc>${SITE_ORIGIN}/blog/${article.slug}/</loc>
    <changefreq>monthly</changefreq>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_ORIGIN}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_ORIGIN}/blog/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
${articleUrls}
</urlset>
`;
}

async function loadArticles(contentDir) {
  const markdown = createMarkdown();
  await validateImageTree(join(contentDir, "images"));
  const entries = await readdir(contentDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const articles = [];

  for (const file of files) {
    const source = await readFile(join(contentDir, file), "utf8");
    const parsed = matter(source);
    const rawTitle = parsed.data.title;

    if (rawTitle !== undefined && typeof rawTitle !== "string") {
      throw new Error(`${file} requires a nonempty string title`);
    }

    const title = (rawTitle || "").trim();
    const slug = basename(file, ".md");

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`${file} has unsafe slug ${slug}`);
    }

    if (!title) {
      throw new Error(`${file} requires a frontmatter title`);
    }

    const rawAuthor = parsed.data.author;

    if (rawAuthor !== undefined && typeof rawAuthor !== "string") {
      throw new Error(`${file} requires a nonempty string author`);
    }

    const author = (rawAuthor || "").trim();

    if (!author) {
      throw new Error(`${file} requires a frontmatter author`);
    }

    const imageDimensions = await validateImages(
      file,
      parsed.content,
      contentDir,
      markdown,
    );
    const body = withoutLeadingTitle(parsed.content);
    const hasDescription = Object.hasOwn(parsed.data, "description");
    const rawDescription = parsed.data.description;

    if (
      hasDescription &&
      (typeof rawDescription !== "string" || !rawDescription.trim())
    ) {
      throw new Error(`${file} description must be a nonempty string`);
    }

    const description = summarize(
      hasDescription ? rawDescription : firstParagraph(markdown, body),
    );
    const hasOrder = Object.hasOwn(parsed.data, "order");
    const order = parsed.data.order;

    if (hasOrder && (!Number.isInteger(order) || order < 1)) {
      throw new Error(`${file} order must be a positive integer`);
    }

    articles.push({
      title,
      author,
      slug,
      description,
      order: hasOrder ? order : Number.MAX_SAFE_INTEGER,
      readingTime: readingTime(body),
      html: markdown.render(body, { imageDimensions }),
    });
  }

  return articles.sort(
    (left, right) =>
      left.order - right.order || left.title.localeCompare(right.title),
  );
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertManagedOutput(outputDir) {
  const marker = join(outputDir, ".generated-by-build-blog");

  if ((await pathExists(outputDir)) && !(await pathExists(marker))) {
    throw new Error("Refusing to replace unmanaged public/blog directory");
  }
}

async function writeBlogOutput(outputDir, contentDir, articles) {
  const canonicalOutput = resolve(outputDir);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, ".generated-by-build-blog"),
    "Generated by scripts/build-blog.js.\n",
  );
  await writeFile(join(outputDir, "index.html"), indexPage(articles));

  for (const article of articles) {
    const articleDir = resolve(outputDir, article.slug);

    if (!articleDir.startsWith(`${canonicalOutput}${sep}`)) {
      throw new Error(`${article.slug} escapes the blog output directory`);
    }

    await mkdir(articleDir, { recursive: true });
    await writeFile(join(articleDir, "index.html"), articlePage(article));
  }

  await cp(join(contentDir, "images"), join(outputDir, "images"), {
    recursive: true,
    force: true,
  });
}

async function replaceGeneratedOutput(
  publicDir,
  outputDir,
  stagingDir,
  sitemapXml,
) {
  const nonce = basename(stagingDir);
  const sitemapPath = join(publicDir, "sitemap.xml");
  const sitemapStaging = join(publicDir, `${nonce}-sitemap.xml`);
  const blogBackup = join(publicDir, `${nonce}-blog-backup`);
  const sitemapBackup = join(publicDir, `${nonce}-sitemap-backup.xml`);
  const hadBlog = await pathExists(outputDir);
  const hadSitemap = await pathExists(sitemapPath);
  let blogBackedUp = false;
  let sitemapBackedUp = false;
  let blogInstalled = false;
  let sitemapInstalled = false;

  await writeFile(sitemapStaging, sitemapXml);

  try {
    if (hadBlog) {
      await rename(outputDir, blogBackup);
      blogBackedUp = true;
    }

    if (hadSitemap) {
      await rename(sitemapPath, sitemapBackup);
      sitemapBackedUp = true;
    }

    await rename(stagingDir, outputDir);
    blogInstalled = true;
    await rename(sitemapStaging, sitemapPath);
    sitemapInstalled = true;
  } catch (error) {
    if (sitemapInstalled) await rm(sitemapPath, { force: true });
    if (sitemapBackedUp) await rename(sitemapBackup, sitemapPath);
    if (blogInstalled) await rm(outputDir, { recursive: true, force: true });
    if (blogBackedUp) await rename(blogBackup, outputDir);
    throw error;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    await rm(sitemapStaging, { force: true });
  }

  if (blogBackedUp) await rm(blogBackup, { recursive: true, force: true });
  if (sitemapBackedUp) await rm(sitemapBackup, { force: true });
}

export async function buildBlog(root) {
  const projectRoot = resolve(root);
  const contentDir = join(projectRoot, "content", "blog");
  const publicDir = join(projectRoot, "public");
  const outputDir = join(projectRoot, "public", "blog");
  const articles = await loadArticles(contentDir);
  await assertManagedOutput(outputDir);
  await mkdir(publicDir, { recursive: true });
  const stagingDir = await mkdtemp(join(publicDir, ".blog-build-"));

  try {
    await writeBlogOutput(stagingDir, contentDir, articles);
    await replaceGeneratedOutput(
      publicDir,
      outputDir,
      stagingDir,
      sitemap(articles),
    );
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  return articles;
}

function readRootArgument(args) {
  const index = args.indexOf("--root");

  if (index === -1) return resolve(new URL("..", import.meta.url).pathname);
  if (!args[index + 1]) throw new Error("--root requires a path");

  return args[index + 1];
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";

if (import.meta.url === entryUrl) {
  buildBlog(readRootArgument(process.argv.slice(2)))
    .then((articles) => {
      console.log(
        `Built ${articles.length} blog article${articles.length === 1 ? "" : "s"}.`,
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
