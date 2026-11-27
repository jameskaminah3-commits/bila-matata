// test/unit/blog.test.ts
//
// The blog on bilamatata.com: every article has what search engines need
// (a title and description of the right length, structured data, a canonical
// address, breadcrumbs), the feed and the sitemap list them, and nothing in
// an article can add markup or a script.

import assert from "node:assert/strict";
import test from "node:test";
import { ARTICLES, articleBySlug } from "../../src/studio/blog/articles.ts";
import { renderArticle, renderBlogIndex, renderBody, renderFeed } from "../../src/studio/blog/pages.ts";
import { renderHome } from "../../src/studio/pages.ts";

const PAGE = { baseUrl: "https://bilamatata.com" };
const ldOf = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">(.+?)<\/script>/gs)].map((match) => JSON.parse(match[1]));

test("every article is ready for search: unique address, title, description, keywords and real sections", () => {
  assert.ok(ARTICLES.length >= 5);
  assert.equal(new Set(ARTICLES.map((article) => article.slug)).size, ARTICLES.length, "no two articles share an address");
  for (const article of ARTICLES) {
    assert.match(article.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, article.slug);
    assert.ok(article.title.length >= 30 && article.title.length <= 70, `${article.slug}: title ${article.title.length} characters`);
    assert.ok(article.description.length >= 110 && article.description.length <= 170, `${article.slug}: description ${article.description.length} characters`);
    assert.match(article.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(article.keywords.length >= 3);
    const { sections } = renderBody(article.body);
    assert.ok(sections.length >= 3, `${article.slug}: sections for the table of contents`);
    assert.ok(article.body.split(/\s+/).length >= 450, `${article.slug}: a real article, not a stub`);
    assert.doesNotMatch(article.body, /\b(Meta|ChatGPT|OpenAI|Gemini|Paystack|tours?|safaris?|car hire|travel\w*)\b/, `${article.slug}: names no other company and stays off travel`);
    for (const [, href] of article.body.matchAll(/\]\(([^)]+)\)/g)) assert.match(href, /^(\/|https:\/\/)/, `${article.slug}: ${href}`);
  }
});

test("an article page carries its structured data, breadcrumbs, canonical address and a way to talk to Zaina", () => {
  const article = articleBySlug("qr-code-menu-restaurants-kenya")!;
  const html = renderArticle(PAGE, article);
  assert.match(html, /<title>QR code menus for restaurants in Kenya: a practical guide \| Bila Matata<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/bilamatata\.com\/blog\/qr-code-menu-restaurants-kenya">/);
  assert.match(html, /<meta property="og:type" content="article">/);
  assert.match(html, /<meta property="article:published_time" content="2026-11-27">/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1, "one heading for the page");
  const [post, crumbs] = ldOf(html);
  assert.equal(post["@type"], "BlogPosting");
  assert.deepEqual([post.headline, post.datePublished, post.mainEntityOfPage["@id"], post.inLanguage], [article.title, "2026-11-27", "https://bilamatata.com/blog/qr-code-menu-restaurants-kenya", "en-KE"]);
  assert.deepEqual(crumbs.itemListElement.map((item: any) => item.name), ["Home", "Blog", article.title]);
  assert.match(html, /<aside class="post-toc" aria-label="On this page">/);
  assert.match(html, /<h2 id="designing-the-table-card">Designing the table card<\/h2>/);
  assert.match(html, /data-open-zaina>Ask Zaina<\/a>/);
  assert.match(html, /<script src="\/zaina\.js" data-business="bilamatata" async><\/script>/);
  assert.match(html, /Keep reading/);
});

test("nothing written in an article can add markup, a script or a javascript: link", () => {
  const { html } = renderBody('A <script>alert(1)</script> line with [a link](javascript:alert(1)) and [ours](/start) and **bold**.\n\n- <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|<img|javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="\/start">ours<\/a>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(renderBody("[site](https://example.com)").html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener">site<\/a>/);
});

test("the index, the feed and the home page all lead to every article", () => {
  const index = renderBlogIndex(PAGE);
  for (const article of ARTICLES) assert.match(index, new RegExp(`href="/blog/${article.slug}"`));
  assert.equal(ldOf(index)[0]["@type"], "Blog");
  const feed = renderFeed("https://bilamatata.com");
  assert.equal((feed.match(/<item>/g) ?? []).length, ARTICLES.length);
  assert.match(feed, /<atom:link href="https:\/\/bilamatata\.com\/blog\/feed\.xml" rel="self"/);
  const home = renderHome(PAGE);
  assert.match(home, /<a href="\/blog"[^>]*>Blog<\/a>/, "in the main navigation");
  assert.equal((home.match(/<article class="post-card">/g) ?? []).length, 3, "the three newest on the home page");
  assert.match(home, /<link rel="alternate" type="application\/rss\+xml"/);
});
