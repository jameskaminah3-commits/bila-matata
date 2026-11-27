// src/studio/blog/pages.ts
//
// The blog on bilamatata.com: /blog (every article), /blog/<slug> (one
// article) and /blog/feed.xml (RSS). Plain server-rendered HTML, so search
// engines read every word without running a script, with the structured
// data they look for (BlogPosting, BreadcrumbList, Blog), a canonical
// address, previews for shared links and a table of contents.

import { STUDIO } from "../brand.ts";
import { esc, siteParts, type SitePage } from "../pages.ts";
import { SITE_ASSETS_VERSION } from "../site-css.ts";
import { articlesByDate, longDate, readMinutes, words, type Article } from "./articles.ts";

export { articlesByDate } from "./articles.ts";

const AUTHOR = `${STUDIO.name} team`;

const anchor = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Bold and links inside a line: the words are escaped first, so nothing in an article can add markup. */
function inline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
      const url = href.replace(/&amp;/g, "&");
      if (!/^(\/|https:\/\/)/.test(url)) return label;
      const external = url.startsWith("https://");
      return `<a href="${esc(url)}"${external ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`;
    });
}

/** The article's body as HTML, and its sections for the table of contents. */
export function renderBody(body: string): { html: string; sections: Array<{ id: string; title: string }> } {
  const sections: Array<{ id: string; title: string }> = [];
  const html = body.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.trim().split("\n").map((line) => line.trim());
    if (lines[0].startsWith("## ")) {
      const title = lines[0].slice(3).trim();
      const id = anchor(title);
      sections.push({ id, title });
      return `<h2 id="${id}">${inline(title)}</h2>`;
    }
    if (lines[0].startsWith("### ")) return `<h3>${inline(lines[0].slice(4).trim())}</h3>`;
    if (lines.every((line) => line.startsWith("- "))) return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join("")}</ul>`;
    if (lines.every((line) => /^\d+\.\s/.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
    return `<p>${inline(lines.join(" "))}</p>`;
  }).join("\n");
  return { html, sections };
}

const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

function card(article: Article, headingLevel: "h2" | "h3"): string {
  return `<article class="post-card">
        <p class="post-meta"><span class="post-tag">${esc(article.category)}</span><span>${esc(longDate(article.published))} · ${readMinutes(article)} min read</span></p>
        <${headingLevel}><a href="/blog/${esc(article.slug)}">${esc(article.title)}</a></${headingLevel}>
        <p>${esc(article.description)}</p>
        <a class="post-more" href="/blog/${esc(article.slug)}" aria-hidden="true" tabindex="-1">Read the article →</a>
      </article>`;
}

export function renderBlogIndex(page: SitePage): string {
  const base = page.baseUrl;
  const articles = articlesByDate();
  const title = "Blog: guides for growing your business | Bila Matata";
  const description = "Practical guides for business owners in Kenya: answering customers faster, QR menus, websites, WhatsApp bookings and M-Pesa, and using AI the right way.";
  const data = base
    ? [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: `${STUDIO.name} blog`,
        description,
        url: `${base}/blog`,
        inLanguage: "en-KE",
        publisher: { "@type": "Organization", name: STUDIO.name, url: base },
        blogPost: articles.map((article) => ({ "@type": "BlogPosting", headline: article.title, url: `${base}/blog/${article.slug}`, datePublished: article.published, dateModified: article.updated ?? article.published })),
      },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: `${base}/` }, { "@type": "ListItem", position: 2, name: "Blog", item: `${base}/blog` }] },
    ]
    : [];
  return `${siteParts.head({ title, description, path: "/blog", baseUrl: base, extra: data.map(jsonLd).join("\n") })}
<body>
${siteParts.header("blog")}
<main id="main" class="blog">
  <section class="blog-hero">
    <div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">Blog</span></nav>
      <p class="eyebrow">The Bila Matata blog</p>
      <h1>Guides for growing your business</h1>
      <p class="lede">Practical, plain-spoken guides for business owners in Kenya and beyond: answering customers faster, menus and websites that sell, WhatsApp and M-Pesa done right, and AI that helps instead of guessing.</p>
    </div>
  </section>
  <section class="band">
    <div class="wrap post-grid">
      ${articles.map((article) => card(article, "h2")).join("\n      ")}
    </div>
  </section>
</main>
${siteParts.footer()}
${siteParts.zainaEmbed()}
<script src="/site/site.js?v=${SITE_ASSETS_VERSION}" defer></script>
</body>
</html>`;
}

export function renderArticle(page: SitePage, article: Article): string {
  const base = page.baseUrl;
  const { html, sections } = renderBody(article.body);
  const modified = article.updated ?? article.published;
  const url = base ? `${base}/blog/${article.slug}` : null;
  const related = articlesByDate().filter((other) => other.slug !== article.slug).slice(0, 3);
  const data = base && url
    ? [
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: article.title,
        description: article.description,
        datePublished: article.published,
        dateModified: modified,
        inLanguage: "en-KE",
        articleSection: article.category,
        keywords: article.keywords.join(", "),
        wordCount: words(article),
        image: [`${base}/site/og.png`],
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        author: { "@type": "Organization", name: AUTHOR, url: base },
        publisher: { "@type": "Organization", name: STUDIO.name, url: base },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${base}/blog` },
          { "@type": "ListItem", position: 3, name: article.title, item: url },
        ],
      },
    ]
    : [];
  return `${siteParts.head({
    title: `${article.title} | ${STUDIO.name}`,
    description: article.description,
    path: `/blog/${article.slug}`,
    baseUrl: base,
    article: { published: article.published, modified, section: article.category },
    extra: data.map(jsonLd).join("\n"),
  })}
<body>
${siteParts.header("blog")}
<main id="main" class="blog">
  <article class="post">
    <header class="post-head">
      <div class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog">Blog</a><span aria-hidden="true">/</span><span aria-current="page">${esc(article.title)}</span></nav>
        <p class="post-meta"><span class="post-tag">${esc(article.category)}</span><span>${esc(AUTHOR)} · <time datetime="${esc(article.published)}">${esc(longDate(article.published))}</time> · ${readMinutes(article)} min read</span></p>
        <h1>${esc(article.title)}</h1>
        <p class="lede">${esc(article.description)}</p>
      </div>
    </header>
    <div class="wrap post-layout">
      ${sections.length > 2 ? `<aside class="post-toc" aria-label="On this page"><p>On this page</p><ol>${sections.map((section) => `<li><a href="#${section.id}">${esc(section.title)}</a></li>`).join("")}</ol></aside>` : ""}
      <div class="prose">
${html}
        <div class="post-cta">
          <p class="post-cta-title">See it work for your business</p>
          <p>Zaina is on this page now. Ask her anything about your business, our plans or how set-up works, anywhere in Kenya or beyond.</p>
          <div class="cta-row"><a class="btn btn-primary" href="/#faq" data-open-zaina>Ask Zaina</a><a class="btn btn-ghost" href="/start">Book a free consultation</a></div>
        </div>
      </div>
    </div>
  </article>
  ${related.length ? `<section class="band alt" aria-labelledby="related-title">
    <div class="wrap">
      <h2 id="related-title" class="related-title">Keep reading</h2>
      <div class="post-grid">
      ${related.map((other) => card(other, "h3")).join("\n      ")}
      </div>
    </div>
  </section>` : ""}
</main>
${siteParts.footer()}
${siteParts.zainaEmbed()}
<script src="/site/site.js?v=${SITE_ASSETS_VERSION}" defer></script>
</body>
</html>`;
}

/** The RSS feed: every article, newest first. */
export function renderFeed(baseUrl: string): string {
  const x = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const articles = articlesByDate();
  const rfc822 = (iso: string) => new Date(`${iso}T09:00:00Z`).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${x(STUDIO.name)} blog</title>
  <link>${x(baseUrl)}/blog</link>
  <atom:link href="${x(baseUrl)}/blog/feed.xml" rel="self" type="application/rss+xml"/>
  <description>Practical guides for business owners in Kenya and beyond.</description>
  <language>en-ke</language>
  ${articles[0] ? `<lastBuildDate>${rfc822(articles[0].updated ?? articles[0].published)}</lastBuildDate>` : ""}
${articles.map((article) => `  <item>
    <title>${x(article.title)}</title>
    <link>${x(baseUrl)}/blog/${x(article.slug)}</link>
    <guid isPermaLink="true">${x(baseUrl)}/blog/${x(article.slug)}</guid>
    <pubDate>${rfc822(article.published)}</pubDate>
    <category>${x(article.category)}</category>
    <description>${x(article.description)}</description>
  </item>`).join("\n")}
</channel>
</rss>
`;
}
