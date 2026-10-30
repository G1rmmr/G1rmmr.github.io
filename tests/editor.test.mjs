import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = readFileSync(new URL("../docs/javascripts/editor.js", import.meta.url), "utf8");
class Element {
  constructor(tag = "div") { this.localName = tag; this.children = []; this.dataset = {}; this.value = ""; this.textContent = ""; this.events = {}; this.isConnected = true; this.selectionStart = 0; this.selectionEnd = 0; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, fn) { this.events[event] = fn; }
  click() { return this.events.click?.(); }
  setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.selectionStart = this.selectionEnd = start + text.length; }
}
async function editor({ saved = null, blocked = false, origin = "https://g1rmmr-blog-publisher.blckhnd-std.workers.dev", replies = [], posts = {}, confirm = true } = {}) {
  const root = new Element();
  const fields = Object.fromEntries(["post-title", "post-body", "post-preview", "editor-status", "post-save", "post-publish", "post-images", "image-status", "image-add", "post-select", "post-load", "post-delete", "post-mode", "post-confirm", "post-confirm-message", "post-confirm-cancel", "post-confirm-accept"].map(id => [id, new Element()]));
  fields["post-confirm"].showModal = () => queueMicrotask(() => fields[confirm ? "post-confirm-accept" : "post-confirm-cancel"].onclick());
  fields["post-confirm"].close = () => {};
  root.querySelector = selector => selector === ".editor-image-add" ? fields["image-add"] : fields[selector.slice(1)];
  const storage = new Map(saved ? [["realm-post-draft-v2", JSON.stringify(saved)]] : []);
  const calls = []; const redirects = [];
  const document = { readyState: "complete", getElementById: () => root, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) };
  const window = { location: { origin, href: origin + "/write/", replace: url => redirects.push(url) }, crypto: webcrypto, confirm: () => confirm, setTimeout: fn => fn(), fetch: async (url, options = {}) => {
    calls.push([url, options]);
    if (url === "/api/session") return { ok: true, json: async () => ({ csrf: "csrf" }) };
    if (url === "/api/posts" && !options.method) return { ok: true, json: async () => ({ posts: Object.entries(posts).map(([path, post]) => ({ path, sha: post.sha, title: post.title })) }) };
    if (url.startsWith("/api/post?")) {
      const path = new URL(url, origin).searchParams.get("path");
      return { ok: Boolean(posts[path]), json: async () => ({ path, ...posts[path] }) };
    }
    if (replies.length) { const reply = replies.shift(); if (reply instanceof Error) throw reply; return reply; }
    if (url.startsWith("/api/deployment")) return { ok: true, json: async () => ({ status: "success" }) };
    if (url === "/api/images") return { ok: true, json: async () => ({ path: `/img/uploads/${"a".repeat(64)}.png` }) };
    if (url === "/api/post") {
      const data = JSON.parse(options.body);
      if (options.method === "DELETE") { delete posts[data.path]; return { ok: true, json: async () => ({ deleted: true, sha: "a".repeat(40), url: "https://g1rmmr.github.io/posts/" }) }; }
      posts[data.path] = { title: data.title, body: data.body, sha: "c".repeat(40) };
      return { ok: true, json: async () => ({ path: data.path, sha: "a".repeat(40), blob_sha: "c".repeat(40), url: "https://g1rmmr.github.io/posts/test/" }) };
    }
    return { ok: true, json: async () => ({ sha: "a".repeat(40), url: "https://g1rmmr.github.io/posts/test/", commit_url: "https://github.com/test" }) };
  } };
  const localStorage = { getItem: key => { if (blocked) throw Error(); return storage.get(key) ?? null; }, setItem: (key, value) => { if (blocked) throw Error(); storage.set(key, value); } };
  vm.runInNewContext(source, { window, document, localStorage, URL });
  await new Promise(setImmediate);
  return { root, fields, storage, calls, redirects };
}
function descendants(node) { return [node, ...(node.children ?? []).flatMap(descendants)]; }

test("public WRITE redirects to authenticated origin before displaying the editor", async () => {
  const e = await editor({ origin: "https://g1rmmr.github.io" });
  assert.equal(e.calls.length, 0);
  assert.deepEqual(e.redirects, ["https://g1rmmr-blog-publisher.blckhnd-std.workers.dev/write/"]);
});
test("restores draft and renders unsafe HTML and script links inert", async () => {
  const e = await editor({ saved: { title: "<img onerror=alert(1)>", body: "## 제목\n**굵게**\n[위험](javascript:alert)\n<script>alert(1)</script>" } });
  const nodes = descendants(e.fields["post-preview"]);
  assert.equal(nodes.filter(n => ["script", "img"].includes(n.localName)).length, 0);
  assert.equal(nodes.find(n => n.localName === "a").href, undefined);
  assert.ok(nodes.some(n => n.localName === "strong"));
});
test("starts empty, posts JSON with CSRF, and shows deployment completion", async () => {
  const e = await editor();
  assert.equal(e.fields["post-title"].value, "");
  assert.equal(e.fields["post-preview"].children.length, 0);
  e.fields["post-title"].value = "테스트"; e.fields["post-body"].value = "**본문**";
  e.root.events.input();
  await e.fields["post-publish"].click();
  const [, options] = e.calls.find(([url, options]) => url === "/api/posts" && options.method === "POST");
  assert.equal(options.headers["X-CSRF-Token"], "csrf");
  assert.equal(JSON.parse(options.body).body, "**본문**");
  assert.match(e.fields["editor-status"].textContent, /배포가 완료/);
  assert.equal(e.fields["post-publish"].disabled, false);
});
test("ambiguous network failures retain the request ID for safe retry", async () => {
  const e = await editor({ blocked: true, replies: [new Error("lost response")] });
  e.fields["post-title"].value = "제목"; e.fields["post-body"].value = "본문".repeat(4000);
  await e.fields["post-publish"].click();
  await e.fields["post-publish"].click();
  const posts = e.calls.filter(([url, options]) => url === "/api/posts" && options.method === "POST").map(([, options]) => JSON.parse(options.body));
  assert.equal(posts[0].request_id, posts[1].request_id);
  assert.equal(posts[1].body, "본문".repeat(4000));
});
test("empty content does not publish and expired sessions keep the draft", async () => {
  const e = await editor({ replies: [{ status: 401 }] });
  await e.fields["post-publish"].click();
  assert.equal(e.calls.filter(([url, options]) => url === "/api/posts" && options.method === "POST").length, 0);
  e.fields["post-title"].value = "제목"; e.fields["post-body"].value = "본문";
  await e.fields["post-publish"].click();
  assert.match(e.fields["editor-status"].textContent, /로그인이 만료/);
  assert.equal(JSON.parse(e.storage.get("realm-post-draft-v2")).body, "본문");
});

test("selected images upload with CSRF and become Markdown plus a safe preview", async () => {
  const e = await editor();
  e.fields["post-images"].files = [{ name: "사진.png", type: "image/png", size: 8 }];
  await e.fields["post-images"].events.change();
  const [, options] = e.calls.find(([url]) => url === "/api/images");
  assert.equal(options.headers["X-CSRF-Token"], "csrf");
  assert.equal(options.headers["Content-Type"], "image/png");
  assert.match(e.fields["post-body"].value, /!\[사진\]\(\/img\/uploads\/a{64}\.png\)/);
  const image = descendants(e.fields["post-preview"]).find(n => n.localName === "img");
  assert.equal(image.src, `https://g1rmmr-blog-publisher.blckhnd-std.workers.dev/media/${"a".repeat(64)}.png`);
});

test("invalid and oversized images are rejected before uploading", async () => {
  const e = await editor();
  for (const file of [{ name: "x.svg", type: "image/svg+xml", size: 10 }, { name: "x.png", type: "image/png", size: 6 * 1024 * 1024 }]) {
    e.fields["post-images"].files = [file];
    await e.fields["post-images"].events.change();
  }
  assert.equal(e.calls.filter(([url]) => url === "/api/images").length, 0);
});

test("loads an existing post and updates the same path and loaded SHA", async () => {
  const path = "docs/posts/example.md";
  const e = await editor({ posts: { [path]: { title: "원본", body: "원본 본문\n", sha: "b".repeat(40) } } });
  e.fields["post-select"].value = path;
  await e.fields["post-load"].click();
  assert.equal(e.fields["post-title"].value, "원본");
  assert.equal(e.fields["post-delete"].hidden, false);
  e.fields["post-title"].value = "수정";
  await e.fields["post-publish"].click();
  const [, options] = e.calls.find(([url, options]) => url === "/api/post" && options.method === "PUT");
  const request = JSON.parse(options.body);
  assert.equal(request.path, path); assert.equal(request.sha, "b".repeat(40));
  assert.equal(e.calls.filter(([url, options]) => url === "/api/posts" && options.method === "POST").length, 0);
  assert.equal(e.fields["post-title"].value, "수정");
});

test("cancelled deletion sends no request; confirmed deletion follows deployment", async () => {
  const path = "docs/posts/example.md";
  for (const confirmed of [false, true]) {
    const e = await editor({ confirm: confirmed, posts: { [path]: { title: "삭제 대상", body: "본문", sha: "b".repeat(40) } } });
    e.fields["post-select"].value = path; await e.fields["post-load"].click();
    await e.fields["post-delete"].click();
    const deletes = e.calls.filter(([url, options]) => url === "/api/post" && options.method === "DELETE");
    assert.equal(deletes.length, confirmed ? 1 : 0);
    if (confirmed) {
      assert.equal(JSON.parse(deletes[0][1].body).sha, "b".repeat(40));
      assert.match(e.fields["editor-status"].textContent, /삭제가 블로그에 반영/);
      assert.equal(e.fields["post-delete"].hidden, true);
    }
  }
});

test("loading a post preserves the independent new-post draft", async () => {
  const path = "docs/posts/example.md";
  const e = await editor({ saved: { title: "작성 중인 새 글", body: "새 글 본문" }, posts: { [path]: { title: "기존 글", body: "기존 본문", sha: "b".repeat(40) } } });
  e.fields["post-select"].value = path; await e.fields["post-load"].click();
  assert.equal(e.fields["post-title"].value, "기존 글");
  e.fields["post-select"].value = ""; await e.fields["post-load"].click();
  assert.equal(e.fields["post-title"].value, "작성 중인 새 글");
});
