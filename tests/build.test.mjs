import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const files = readdirSync(new URL("../docs/posts/", import.meta.url)).filter(name => name.endsWith(".md") && name !== "index.md");

test("every source post has a page, search entry and date in newest-first order", () => {
  const listing = read("site/posts/index.html");
  const search = JSON.parse(read("site/search.json"));
  const dates = [...listing.matchAll(/<time datetime="([^"]+)">(\d{6})<\/time>/g)];
  assert.equal(dates.length, files.length);
  assert.deepEqual(dates.map(m => m[1]), dates.map(m => m[1]).sort().reverse());
  for (const name of files) {
    const [, year, month, day] = /^(\d{4})-(\d+)-(\d+)/.exec(name);
    const iso = [year, month.padStart(2, "0"), day.padStart(2, "0")].join("-");
    const url = "/posts/" + encodeURIComponent(name.slice(0, -3)) + "/";
    const row = listing.split("<li>").find(item => item.startsWith(`<a href="${url}">`));
    assert.ok(row?.includes(`<time datetime="${iso}">${iso.slice(2).replaceAll("-", "")}</time>`), name);
    const entry = search.find(item => item.url === url);
    assert.ok(entry?.text.length, name);
    assert.ok(read("site" + decodeURI(url) + "index.html").includes("<h1"), name);
  }
});

test("home, search and editor link to rendered assets", () => {
  assert.ok(read("site/index.html").includes('href="posts/"'));
  assert.ok(read("site/write/index.html").includes('id="blog-editor"'));
  assert.ok(read("site/write/index.html").includes('src="/javascripts/editor.js"'));
  assert.ok(read("site/search/index.html").includes('src="/assets/search.js"'));
  for (const path of ["javascripts/editor.js", "assets/search.js", "stylesheets/extra.css", "sitemap.xml", "404.html"]) assert.ok(read("site/" + path).length);
});

