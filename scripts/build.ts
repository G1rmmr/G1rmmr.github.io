import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import { build } from "esbuild";
import { codeLabel } from "../docs/javascripts/code-label.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const docs = join(root, "docs");
const site = join(root, "site");
const origin = "https://g1rmmr.github.io";
const publisher = "https://g1rmmr-blog-publisher.blckhnd-std.workers.dev/write/";
const md = new MarkdownIt({
  html: true,
  highlight(code, lang) {
    return hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : "";
  },
});
const escape = md.utils.escapeHtml;
const renderFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, i, options, env, renderer) => {
  const language = tokens[i].info.trim().split(/\s+/)[0];
  const html = renderFence(tokens, i, options, env, renderer);
  return language ? html.replace("<pre>", () => `<pre data-language="${escape(codeLabel(language))}">`) : html;
};
const linkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, i, options, env, renderer) => {
  const href = tokens[i].attrGet("href");
  if (typeof href === "string" && !/^(?:[a-z]+:|\/\/)/i.test(href)) {
    tokens[i].attrSet("href", href.replace(/(?:^|\/)index\.md(?=[?#]|$)/, "/").replace(/\.md(?=[?#]|$)/, "/"));
  }
  return linkOpen ? linkOpen(tokens, i, options, env, renderer) : renderer.renderToken(tokens, i, options);
};

interface Entry { url: string; title: string; text: string }
const entries: Entry[] = [];
const paths: string[] = [];
async function emit(path: string, content: string) {
  const file = join(site, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function page(url: string, title: string, body: string, script = "") {
  const nav = [["/", "소개"], ["/posts/", "게시물"], ["/search/", "검색"], [publisher, "글쓰기"]]
    .map(([href, label]) => {
      const current = href === url || (href === publisher && url === "/write/") ? "page"
        : href === "/posts/" && url.startsWith(href) ? "location" : "";
      return `<a href="${href}"${current ? ` aria-current="${current}"` : ""}>${label}</a>`;
    }).join("");
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · R E A L M</title><link rel="icon" href="/img/favicon.png"><link rel="stylesheet" href="/stylesheets/extra.css"></head>
<body><a class="skip" href="#content">본문으로</a><header class="masthead"><div class="masthead-inner"><a href="/" class="brand" aria-label="REALM 홈">REALM</a><nav aria-label="주 메뉴">${nav}</nav></div></header><main id="content" tabindex="-1">${body}</main>${script ? `<script defer src="${script}"></script>` : ""}</body></html>`;
  await emit(url === "/404.html" ? "404.html" : decodeURIComponent(url.slice(1)) + "index.html", html);
  if (url !== "/404.html") paths.push(url);
}

function render(source: string, url: string) {
  const tokens = md.parse(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""), {});
  const heading = tokens.findIndex(t => t.type === "heading_open" && t.tag === "h1");
  const title = tokens[heading + 1]?.content || url;
  const seen = new Set<string>();
  const sections: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open") continue;
    const label = tokens[i + 1].content;
    const base = label.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
    let id = base;
    for (let n = 1; seen.has(id); n++) id = base + "_" + n;
    seen.add(id);
    tokens[i].attrSet("id", id);
    if (tokens[i].tag === "h2") sections.push(`<li><a href="#${escape(id)}">${escape(label)}</a></li>`);
  }
  entries.push({ url, title, text: tokens.filter(t => t.type === "inline").map(t => t.content).join(" ") });
  let body = md.renderer.render(tokens, md.options, {});
  if (sections.length && url.startsWith("/posts/")) body = body.replace("</h1>", `</h1><details><summary>목차</summary><ul>${sections.join("")}</ul></details>`);
  return { title, body };
}

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
for (const dir of ["img", "stylesheets"]) await cp(join(docs, dir), join(site, dir), { recursive: true });
interface Post { url: string; title: string; date: string }
const posts: Post[] = [];
const timestamp = (date: string) => `<time datetime="${date}">${date.slice(2).replaceAll("-", "")}</time>`;
function postList(items: Post[]) {
  return `<ul class="post-list">${items.map(p =>
    `<li><a href="${p.url}">${escape(p.title)}</a>${timestamp(p.date)}</li>`
  ).join("")}</ul>`;
}
for (const name of await readdir(join(docs, "posts"))) {
  if (!name.endsWith(".md") || name === "index.md") continue;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:-|\.md$)/.exec(name);
  if (!match) throw new Error("게시 날짜가 없는 파일: " + name);
  const date = [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-");
  if (new Date(date).toISOString().slice(0, 10) !== date) throw new Error("잘못된 게시 날짜: " + name);
  const url = "/posts/" + encodeURIComponent(name.slice(0, -3)) + "/";
  const post = render(await readFile(join(docs, "posts", name), "utf8"), url);
  posts.push({ url, title: post.title, date });
  await page(url, post.title, `<article class="reading"><div class="reading-meta"><a href="/posts/">← 게시물 목록</a>${timestamp(date)}</div>${post.body}<footer><a href="/posts/">게시물 목록으로</a></footer></article>`);
}
posts.sort((a,b) => b.date.localeCompare(a.date) || b.url.localeCompare(a.url));
const home = render(await readFile(join(docs, "index.md"), "utf8"), "/");
await page("/", home.title, home.body.replace("<!-- recent-posts -->", postList(posts.slice(0, 3))));
await page("/posts/", "게시물", `<section class="archive"><h1>게시물</h1>${postList(posts)}</section>`);
await page("/write/", "글쓰기", await readFile(join(docs,"write.md"),"utf8"), "/javascripts/editor.js");
await page("/search/", "검색", '<section class="search"><h1>검색</h1><label for="query">제목 또는 본문</label><input id="query" name="q" type="search" placeholder="검색어 입력" enterkeyhint="search"><p role="status"></p><ul id="results"></ul></section>', "/assets/search.js");
await page("/404.html", "페이지를 찾을 수 없습니다", '<h1>페이지를 찾을 수 없습니다</h1><a href="/posts/">게시물 목록</a>');
await emit("search.json", JSON.stringify(entries));
await emit("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + paths.map(p => "<url><loc>" + origin + p + "</loc></url>").join("") + "</urlset>");
await build({ absWorkingDir: root, entryPoints: { "javascripts/editor": "docs/javascripts/editor.ts", "assets/search": "docs/javascripts/search.ts" }, bundle: true, outdir: site, target: "es2022" });

