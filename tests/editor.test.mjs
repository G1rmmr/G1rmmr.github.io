import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = readFileSync(new URL("../docs/javascripts/editor.js", import.meta.url), "utf8");
class Element {
  constructor(tag = "div") { this.localName = tag; this.children = []; this.dataset = {}; this.value = ""; this.textContent = ""; this.events = {}; this.isConnected = true; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, fn) { this.events[event] = fn; }
  click() { return this.events.click?.(); }
}
async function editor({ saved = null, blocked = false, origin = "https://g1rmmr-blog-publisher.blckhnd-std.workers.dev", replies = [] } = {}) {
  const root = new Element();
  const fields = Object.fromEntries(["post-title", "post-body", "post-preview", "editor-status", "post-save", "post-publish"].map(id => [id, new Element()]));
  root.querySelector = selector => fields[selector.slice(1)];
  const storage = new Map(saved ? [["realm-post-draft-v2", JSON.stringify(saved)]] : []);
  const calls = []; const redirects = [];
  const document = { readyState: "complete", getElementById: () => root, createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }) };
  const window = { location: { origin, href: origin + "/write/", replace: url => redirects.push(url) }, crypto: webcrypto, setTimeout: fn => fn(), fetch: async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/session") return { ok: true, json: async () => ({ csrf: "csrf" }) };
    if (replies.length) { const reply = replies.shift(); if (reply instanceof Error) throw reply; return reply; }
    if (url.startsWith("/api/deployment")) return { ok: true, json: async () => ({ status: "success" }) };
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
  const [, options] = e.calls.find(([url]) => url === "/api/posts");
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
  const posts = e.calls.filter(([url]) => url === "/api/posts").map(([, options]) => JSON.parse(options.body));
  assert.equal(posts[0].request_id, posts[1].request_id);
  assert.equal(posts[1].body, "본문".repeat(4000));
});
test("empty content does not publish and expired sessions keep the draft", async () => {
  const e = await editor({ replies: [{ status: 401 }] });
  await e.fields["post-publish"].click();
  assert.equal(e.calls.length, 1);
  e.fields["post-title"].value = "제목"; e.fields["post-body"].value = "본문";
  await e.fields["post-publish"].click();
  assert.match(e.fields["editor-status"].textContent, /로그인이 만료/);
  assert.equal(JSON.parse(e.storage.get("realm-post-draft-v2")).body, "본문");
});
