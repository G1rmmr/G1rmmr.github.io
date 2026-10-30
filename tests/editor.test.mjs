import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

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
  const fields = Object.fromEntries(["post-title", "post-slug", "post-body", "post-preview", "editor-status", "post-save", "post-download"].map(id => [id, new Element()]));
  const buttons = ["heading", "bold", "italic", "link", "list", "code"].map(format => { const e = new Element("button"); e.dataset.format = format; return e; });
  root.querySelector = selector => fields[selector.slice(1)];
  root.querySelectorAll = () => buttons;
  const storage = new Map(saved ? [["realm-post-draft-v1", JSON.stringify(saved)]] : []);
  const blobs = [];
  const document = {
    readyState: "complete", body: new Element("body"), getElementById: () => root,
    createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }),
  };
  class BlobURL extends URL { static createObjectURL(blob) { blobs.push(blob); return "blob:test"; } static revokeObjectURL() {} }
  const window = { location: new URL("https://example.com/write/"), setTimeout: fn => fn() };
  const localStorage = { getItem: key => { if (blocked) throw Error(); return storage.get(key) ?? null; }, setItem: (key, value) => { if (blocked) throw Error(); storage.set(key, value); } };
  const context = vm.createContext({ window, document, localStorage, URL: BlobURL, Blob });
  const execute = () => vm.runInContext(source, context);
  execute();
  return { root, fields, buttons, storage, blobs, execute };
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

test("formats selection, saves draft, and exports exact Markdown content", async () => {
  const e = editor();
  e.fields["post-title"].value = "테스트";
  e.fields["post-slug"].value = "new-post";
  const body = e.fields["post-body"]; body.value = "내용"; body.setSelectionRange(0, 2);
  e.buttons.find(b => b.dataset.format === "bold").click();
  assert.equal(body.value, "**내용**");
  assert.equal(JSON.parse(e.storage.get("realm-post-draft-v1")).body, "**내용**");
  e.fields["post-download"].click();
  assert.equal(await e.blobs[0].text(), "# 테스트\n\n**내용**\n");
  assert.equal(e.fields["post-preview"].children[0].textContent, "테스트");
});

test("invalid filename blocks export and unavailable storage still allows file export", () => {
  const e = editor({ blocked: true });
  e.fields["post-title"].value = "제목"; e.fields["post-body"].value = "본문";
  e.fields["post-slug"].value = "../other";
  e.fields["post-download"].click();
  assert.equal(e.blobs.length, 0);
  e.fields["post-slug"].value = "valid-post";
  e.fields["post-download"].click();
  assert.equal(e.blobs.length, 1);
});
