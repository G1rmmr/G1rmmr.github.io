import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = readFileSync(new URL("../docs/javascripts/editor.js", import.meta.url), "utf8");

class Element {
  constructor(tag = "div") { this.localName = tag; this.children = []; this.dataset = {}; this.value = ""; this.textContent = ""; this.events = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, fn) { this.events[event] = fn; }
  click() { this.events.click?.(); }
  remove() {}
  focus() {}
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); }
}

function editor({ saved = null, blocked = false } = {}) {
  const root = new Element();
  const fields = Object.fromEntries(["post-title", "post-body", "post-preview", "editor-status", "post-save", "post-publish"].map(id => [id, new Element()]));
  root.querySelector = selector => fields[selector.slice(1)];
  const storage = new Map(saved ? [["realm-post-draft-v2", JSON.stringify(saved)]] : []);
  const blobs = [];
  const opened = [];
  const document = {
    readyState: "complete", body: new Element("body"), getElementById: () => root,
    createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }),
  };
  class BlobURL extends URL { static createObjectURL(blob) { blobs.push(blob); return "blob:test"; } static revokeObjectURL() {} }
  const window = { location: new URL("https://example.com/write/"), crypto: webcrypto, open: (...args) => opened.push(args), setTimeout: fn => fn() };
  const localStorage = { getItem: key => { if (blocked) throw Error(); return storage.get(key) ?? null; }, setItem: (key, value) => { if (blocked) throw Error(); storage.set(key, value); } };
  const context = vm.createContext({ window, document, localStorage, URL: BlobURL, Blob });
  const execute = () => vm.runInContext(source, context);
  execute();
  return { root, fields, storage, blobs, opened, execute };
}

function descendants(node) { return [node, ...(node.children ?? []).flatMap(descendants)]; }

test("restores draft, renders safe nodes and keeps script URLs inert", () => {
  const e = editor({ saved: { title: "<img onerror=alert(1)>", slug: "new-post", body: "## 제목\n**굵게**\n[위험](javascript:alert)\n<script>alert(1)</script>\n```html\n<img onerror=alert(1)>\n```" } });
  const nodes = descendants(e.fields["post-preview"]);
  assert.equal(nodes.filter(n => ["script", "img"].includes(n.localName)).length, 0);
  assert.equal(nodes.find(n => n.localName === "a").href, undefined);
  assert.ok(nodes.some(n => n.localName === "h2"));
  assert.ok(nodes.some(n => n.localName === "strong"));
  assert.equal(e.fields["post-title"].value, "<img onerror=alert(1)>");
});

test("starts blank and publishes exact Markdown with a stable automatic filename", () => {
  const e = editor();
  assert.equal(e.fields["post-title"].value, "");
  assert.equal(e.fields["post-body"].value, "");
  assert.equal(e.fields["post-preview"].children.length, 0);
  e.fields["post-title"].value = "테스트";
  e.fields["post-body"].value = "**내용**";
  e.root.events.input();
  assert.equal(JSON.parse(e.storage.get("realm-post-draft-v2")).body, "**내용**");
  e.fields["post-publish"].click();
  const url = new URL(e.opened[0][0]);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/G1rmmr/G1rmmr.github.io/new/main");
  assert.match(url.searchParams.get("filename"), /^docs\/posts\/\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.md$/);
  assert.equal(url.searchParams.get("value"), "# 테스트\n\n**내용**\n");
  e.fields["post-publish"].click();
  assert.equal(new URL(e.opened[1][0]).searchParams.get("filename"), url.searchParams.get("filename"));
  assert.equal(e.blobs.length, 0);
  assert.equal(e.fields["post-preview"].children[0].textContent, "테스트");
});

test("empty fields block publication and long posts are never truncated even with blocked storage", async () => {
  const e = editor({ blocked: true });
  e.fields["post-publish"].click();
  assert.equal(e.opened.length, 0);
  assert.equal(e.blobs.length, 0);
  e.fields["post-title"].value = "제목"; e.fields["post-body"].value = "본문".repeat(4000);
  e.fields["post-publish"].click();
  assert.equal(e.blobs.length, 1);
  assert.equal(await e.blobs[0].text(), `# 제목\n\n${"본문".repeat(4000)}\n`);
  assert.equal(e.opened[0][0], "https://github.com/G1rmmr/G1rmmr.github.io/upload/main/docs/posts");
});
